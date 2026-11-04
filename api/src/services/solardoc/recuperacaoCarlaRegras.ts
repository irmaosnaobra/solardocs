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
/**
 * Marca de "descartado": o lead reprovou na avaliação por motivo que NÃO volta atrás (comprou, já falou com a linha, pediu para não receber,
 * mudo). O robô grava `quiz_rec_pulou:<hmac>` e a fila nunca mais o avalia, para ele não gastar as avaliações da rodada (a leitura é de 120 h).
 * Só tira lead da fila: nunca faz ninguém receber mensagem. Motivo que pode mudar (posse, humano na conversa, leitura) segue reavaliado.
 */
export const PREFIXO_PULOU_REC = 'quiz_rec_pulou:';
export const MOTIVOS_PERMANENTES_REC: ReadonlySet<string> = new Set(['comprou', 'ja_falou', 'suprimido', 'mudo']);
/** A vez de 10 min do robô: fora de BOT_SENT_PREFIXES (não é envio). */
export const PREFIXO_VEZ_REC = 'quiz_rec_vez:';
/** Pausa pelo banco (mesma tabela e mesmo mecanismo de ag5040_linha_pausa). */
export const CHAVE_PAUSA_QUIZ_REC = 'quiz_rec_pausa';
/** Hora da largada: o robô só considera lead gravado depois dela. */
export const CHAVE_LARGADA_REC = 'quiz_rec_largada';

import { ehFeriadoBR } from '../../utils/feriadosBR';

export const ESPERA_MIN_MS = 15 * 60_000;
/** A janela da Carla: 48 h de idade ÚTIL (sem domingo e feriado, ver `idadeUtilMs`). */
export const JANELA_MAX_MS = 48 * 3600_000;
/** Teto de calendário (03/11/2026): passou disto o lead está vencido, não importa a idade útil. */
export const TETO_CALENDARIO_MS = 120 * 3600_000;
/**
 * O tick do B1 lê até aqui quando o robô está ligado, para dar o aviso de "venceu" ao lead que acabou de vencer: o teto de calendário
 * mais 2 h de folga. É sempre maior que JANELA_MAX_MS (o tick lê de `JANELA_LEITURA_COM_ROBO_MS` atrás até `JANELA_MAX_MS` atrás).
 */
export const JANELA_LEITURA_COM_ROBO_MS = TETO_CALENDARIO_MS + 2 * 3600_000;
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

const DIA_MS = 24 * 3600_000;
const BRT_MS = 3 * 3600_000;   // Brasília é UTC-3 o ano todo (sem horário de verão desde 2019): o mesmo deslocamento do `diaBRT`

/**
 * Idade do lead em ms SEM contar domingo e feriado nacional. Os dias excluídos são dias INTEIROS de Brasília (00:00 a 24:00);
 * a noite dos dias úteis (e o sábado) continua contando. `desde` e `agora` em ms (UTC). Idade negativa vale 0.
 */
export function idadeUtilMs(desde: number, agora: number): number {
  if (!Number.isFinite(desde) || !Number.isFinite(agora) || agora <= desde) return 0;
  let util = agora - desde;
  // índice do dia de Brasília (dias desde 1970-01-01, já no fuso)
  const primeiro = Math.floor((desde - BRT_MS) / DIA_MS);
  const ultimo = Math.floor((agora - BRT_MS) / DIA_MS);
  for (let dia = primeiro; dia <= ultimo; dia++) {
    const data = new Date(dia * DIA_MS);
    if (data.getUTCDay() !== 0 && !ehFeriadoBR(data.toISOString().slice(0, 10))) continue;
    const ini = dia * DIA_MS + BRT_MS;   // 00:00 de Brasília, em UTC
    util -= Math.max(0, Math.min(agora, ini + DIA_MS) - Math.max(desde, ini));
  }
  return util;
}

/**
 * 'cedo' = menos de 15 min de calendário; 'vencido' = mais de 48 h de idade útil OU mais de 120 h de calendário; null = dentro da janela.
 * Hora ilegível vale 'cedo' (nunca envia).
 */
export function foraDoTempo(l: Pick<LeadRec, 'created_time'>, agoraMs: number): 'cedo' | 'vencido' | null {
  const idade = idadeMs(l, agoraMs);
  if (idade === null || idade < ESPERA_MIN_MS) return 'cedo';
  if (idade > TETO_CALENDARIO_MS || idadeUtilMs(agoraMs - idade, agoraMs) > JANELA_MAX_MS) return 'vencido';
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

// ── quem chegou na parte do pagamento (03/11/2026) ───────────────────────────
// O `POST /payments/pix-recorrente/publico` (origem quiz_solardoc ou lp_solardoc) grava `quiz_pagto:<hmac>`. A rodada da Carla chama quem
// gerou o Pix e não pagou, 5 min depois, pelo mesmo portão e pelo mesmo claim `quiz_rec_sent:<hmac>` da mensagem de 15 min.

/** Marca do pagamento: fica FORA de BOT_SENT_PREFIXES (não é envio). A chave leva o MESMO hmac do claim `quiz_rec_sent:`. */
export const PREFIXO_PAGTO = 'quiz_pagto:';
/** Claim do e-mail fora da janela: 1 por contrato. */
export const PREFIXO_PAGTO_EMAIL = 'quiz_pagto_email:';
/** A marca só vale com 5 min ou mais (a pessoa pode estar pagando agora). */
export const PAGTO_ESPERA_MS = 5 * 60_000;
/** A marca vale por 120 h, como o teto de calendário da Carla. */
export const PAGTO_VALE_MS = TETO_CALENDARIO_MS;
/**
 * O código do contrato `pendente` vale 60 min no banco (a troca do contrato só acontece com 65 min, ver pixRecorrenteService). A recuperação:
 * menos de 55 min = textos A/B com o código; de 55 a 65 min = espera (nada sai nesta rodada); 65 min ou mais = texto C com o link, quando o
 * QR velho já não paga e o link gera um novo de verdade. Contrato que não está `pendente` vai direto ao link.
 */
export const PAGTO_CODIGO_VIVO_MS = 55 * 60_000;
export const PAGTO_CODIGO_VENCIDO_MS = 65 * 60_000;

export type FaseDoCodigo = 'codigo' | 'espera' | 'link';

/** Em que fase está o contrato. Sem `created_at` legível (ou `pendente` sem código para mandar antes dos 65 min) espera. */
export function faseDoCodigo(c: { status: string; created_at: string | null; qr_payload: string | null }, agoraMs: number): FaseDoCodigo {
  if (c.status !== 'pendente') return 'link';
  const criado = Date.parse(String(c.created_at ?? ''));
  if (!Number.isFinite(criado)) return 'espera';
  const idade = agoraMs - criado;
  if (idade >= PAGTO_CODIGO_VENCIDO_MS) return 'link';
  // O código só vale como código se for um copia e cola de Pix de verdade (começa em 000201).
  if (idade < PAGTO_CODIGO_VIVO_MS && String(c.qr_payload ?? '').startsWith('000201')) return 'codigo';
  return 'espera';
}

export interface MarcaPagto {
  hmac: string;
  em: string;
  contratoId: string;
  origem: string;
  email: string | null;
  nome: string | null;
  utm_term: string | null;
  lp_session: string | null;
}

/** Lê o valor gravado em `quiz_pagto:<hmac>`. Valor torto = null. */
export function marcaDeLinha(key: string, value: unknown): MarcaPagto | null {
  if (!key.startsWith(PREFIXO_PAGTO) || !value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const txt = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const em = txt(v.em);
  const contratoId = txt(v.contratoId);
  const hmac = key.slice(PREFIXO_PAGTO.length);
  if (!hmac || !em || !contratoId || !Number.isFinite(Date.parse(em))) return null;
  return {
    hmac, em, contratoId, origem: txt(v.origem) ?? '', email: txt(v.email), nome: txt(v.nome),
    utm_term: txt(v.utm_term), lp_session: txt(v.lp_session),
  };
}

/**
 * Depoimentos de clientes (04/11/2026, ordem do dono: convencer da qualidade da plataforma). Cada um é UMA frase literal: sem link, sem colchete e
 * sem travessão, senão o `textoDaCarla` reprova. Ficam na mesma bolha do texto que os leva.
 */
export const DEP_VANDERLEI =
  'O Vanderlei, da American Energy Solar, de Rondonópolis/MT, conta: "Entre todas que já usei e outras que apenas testei, essa é a que conseguimos gerar propostas mais rapidamente."';
export const DEP_ALESSANDRO =
  'O Alessandro Goulart, da Força Solar, de Feliz/RS, conta: "Aqui, com quatro, cinco cliques eu consigo montar uma proposta."';
export const DEP_GSI =
  'A GSI Energia Solar, de Unaí/MG, conta: "Tenho me surpreendido positivamente com o nível de detalhes das propostas."';

/** Carimbo do 2º toque (um por pessoa, para sempre): `quiz_rec_sent2:<hmac>`. Nunca existe um 3º. */
export const PREFIXO_CARIMBO2_REC = 'quiz_rec_sent2:';
/** Claim do e-mail do dia seguinte: 1 por contrato. */
export const PREFIXO_PAGTO_EMAIL2 = 'quiz_pagto_email2:';

// Os textos do redator, aprovados. Só os colchetes mudam (e a frase dos números virou o depoimento do Alessandro, 04/11/2026).
export const TEXTO_PAGTO_A =
  'Oi, [nome], aqui é a Carla, da SolarDoc. Seu Pix da [empresa] ainda está valendo. ' + DEP_ALESSANDRO + ' É o Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc, e você cancela quando quiser pelo app do banco. Vou te mandar o código aqui embaixo, é só copiar e colar no Pix copia e cola do seu banco.';
export const TEXTO_PAGTO_B1 =
  'Oi, [nome], aqui é a Carla, da SolarDoc. Seu Pix ainda está valendo. ' + DEP_ALESSANDRO + ' É o Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, dona da SolarDoc, e você cancela quando quiser pelo app do banco. Vou te mandar o código aqui embaixo, é só copiar e colar no Pix copia e cola do seu banco.';
export const TEXTO_PAGTO_B2 = TEXTO_PAGTO_B1.replace('Oi, [nome], aqui é a Carla', 'Oi, aqui é a Carla');
export const TEXTO_PAGTO_C1 =
  '[saudacao], [nome], aqui é a Carla, da SolarDoc. O Pix que você gerou já venceu, mas é só abrir [link] e gerar outro, leva 1 minuto. É Pix automático de R$ 67 por mês, no nome da AIOROS GROUP, e você cancela quando quiser pelo app do banco. ' + DEP_ALESSANDRO;
export const TEXTO_PAGTO_C2 = TEXTO_PAGTO_C1.replace('[saudacao], [nome], aqui é a Carla', '[saudacao], aqui é a Carla');

/** Link para gerar outro Pix. Sem `utm_term` vai sem ele. `meio` = whatsapp ou email. */
export function linkDoPagamento(utmTerm: string | null | undefined, meio: 'whatsapp' | 'email'): string {
  const base = `https://solardoc.app/?pagar=pix&utm_source=recuperacao&utm_medium=${meio}`;
  const t = String(utmTerm ?? '').trim();
  return t ? `${base}&utm_term=${encodeURIComponent(t)}` : base;
}

// ── o 2º toque (04/11/2026) ─────────────────────────────────────────────────
// Um só, no dia útil seguinte ao 1º, para quem recebeu o 1º toque, não pagou e não respondeu. Leva o link (o QR já venceu).
export const TEXTO_TOQUE2_T1 =
  'Oi, [nome], aqui é a Carla, da SolarDoc. [depoimento] Dá para gerar o Pix automático em 1 minuto em [link]. O banco debita sozinho e você cancela quando quiser pelo app do banco.';
export const TEXTO_TOQUE2_T2 = TEXTO_TOQUE2_T1.replace('Oi, [nome], aqui é a Carla', 'Oi, aqui é a Carla');

/**
 * O texto do 2º toque. O depoimento é o OUTRO do 1º toque: o 1º do pagamento usou o Alessandro, então o 2º usa o Vanderlei; o 1º da mensagem de
 * 15 min usou o Vanderlei, então o 2º usa o Alessandro. `primeiroTipo` desconhecido (carimbo antigo) vale a mensagem de 15 min.
 */
export function montarTextoToque2(e: { nome: string | null; utmTerm: string | null; primeiroTipo: string | null | undefined }): string {
  const dep = e.primeiroTipo === 'pagamento' ? DEP_VANDERLEI : DEP_ALESSANDRO;
  const base = e.nome ? TEXTO_TOQUE2_T1.replace('[nome]', () => e.nome as string) : TEXTO_TOQUE2_T2;
  return base.replace('[depoimento]', () => dep).replace('[link]', () => linkDoPagamento(e.utmTerm, 'whatsapp'));
}

/** Primeiro nome para o texto do pagamento: "Cliente" (o nome que o sistema põe quando não há) e nome ilegível valem sem nome. */
export function nomeDoPagamento(...candidatos: Array<string | null | undefined>): string | null {
  for (const c of candidatos) {
    const n = primeiroNome(c);
    if (n && n.toLocaleLowerCase('pt-BR') !== 'cliente') return n;
  }
  return null;
}

export interface EntradaTextoPagto {
  /** Fase `codigo` (menos de 55 min, com `qr_payload`): manda o código. Senão manda o link (fase `link`). */
  codigoVivo: boolean;
  qrPayload: string | null;
  nome: string | null;
  /** Empresa do lead do quiz, já limpa; null = a pessoa veio da LP (ou o lead do quiz não foi achado). */
  empresa: string | null;
  utmTerm: string | null;
  /** Hora BRT (0 a 23) do envio: "Bom dia" só antes das 12h. */
  horaBrt: number;
}

export interface TextoPagto { texto: string; segundo: string | null; tipo: 'A' | 'B1' | 'B2' | 'C1' | 'C2' }

/** O texto de quem chegou no pagamento: A, B1 ou B2 com o código logo depois (2ª mensagem), ou C1 ou C2 com o link. */
export function montarTextoPagamento(e: EntradaTextoPagto): TextoPagto {
  if (e.codigoVivo && e.qrPayload && e.qrPayload.startsWith('000201')) {
    if (e.nome && e.empresa) return { tipo: 'A', texto: TEXTO_PAGTO_A.replace('[nome]', () => e.nome as string).replace('[empresa]', () => e.empresa as string), segundo: e.qrPayload };
    if (e.nome) return { tipo: 'B1', texto: TEXTO_PAGTO_B1.replace('[nome]', () => e.nome as string), segundo: e.qrPayload };
    return { tipo: 'B2', texto: TEXTO_PAGTO_B2, segundo: e.qrPayload };
  }
  const saudacao = e.horaBrt < 12 ? 'Bom dia' : 'Oi';
  const link = linkDoPagamento(e.utmTerm, 'whatsapp');
  const base = e.nome ? TEXTO_PAGTO_C1.replace('[nome]', () => e.nome as string) : TEXTO_PAGTO_C2;
  return { tipo: e.nome ? 'C1' : 'C2', texto: base.replace('[saudacao]', () => saudacao).replace('[link]', () => link), segundo: null };
}

/** Empresa do lead do quiz para o texto A (uma linha, sem emoji nem link), ou null. */
export function empresaDoQuiz(fieldData: unknown): string | null {
  const bruta = campoFd(fieldData, 'Empresa');
  return bruta ? textoDePessoa(bruta, 60) : null;
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
  'Oi, [nome], aqui é a Carla, da SolarDoc. Olhei o diagnóstico da [empresa] e deu [indice] de 100, com [pilar] pesando mais. O que mais falta na sua proposta é [falta]. ' + DEP_VANDERLEI + ' Quer ver como fica a proposta da [empresa] na SolarDoc?';

/** A frase que entra no texto de quem prefere pagar no Pix. Fixa: sem link, sem código, sem valor. */
export const FRASE_PIX_POR_AQUI = 'Dá para assinar no Pix automático, que o banco debita sozinho todo mês.';

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
