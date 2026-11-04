// ─────────────────────────────────────────────────────────────────────────────
// A CARLA RETOMA OS USUÁRIOS DA SOLARDOC QUE NÃO PAGAM (03/11/2026): as regras PURAS.
//
// Nada aqui lê banco, relógio ou env: tudo recebe o que precisa. O robô (retomadaUsuarios.ts), o modo seco, o painel e a Central usam as
// MESMAS funções, para nunca discordarem sobre quem entra, em que ordem, com que texto e por que o robô parou.
// Os ajudantes de agentes5040/relogio.ts e de utils/feriadosBR.ts só convertem o instante que recebem.
//
// O desenho (plano de 31/10, revisto em 03/11, e os pareceres do chefe-antiban):
//   · UMA mensagem por pessoa, para sempre, numa bolha de até 160 caracteres, sem link e sem emoji;
//   · público: conta que NÃO paga hoje e tem WhatsApp no cadastro (grátis que nunca pagou, ou ex-assinante);
//   · ordem: o mais quente primeiro (ex-assinante que respondeu, quem já respondeu alguma vez, o resto);
//   · o texto vai pelo GRUPO DE PAGAMENTO: "assinou" só para quem tem pagamento provado (sales status paid e valor > 0);
//   · a campanha CEDE à agenda dentro da hora (cede_a_agenda) e nunca sai no dia do deploy (inicioEfetivoMs).
// ─────────────────────────────────────────────────────────────────────────────

import { diaBRT, diaDaSemanaBRT, horaBRT } from '../agentes5040/relogio';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { chaveDoTelefone, normalizarTelefoneSd } from './quizSolardoc';
import type { MsgConversa } from '../agentes5040/tipos';

// ── nomes e chaves (fonte única) ─────────────────────────────────────────────

export const ROBO_RETOMADA_USUARIOS = 'carla_retomada_usuarios';
/** Carimbo frio: `usu_rec_sent:<hmac do telefone>`. Um por pessoa, para sempre (claim por insert). Entra em BOT_SENT_PREFIXES. */
export const PREFIXO_CARIMBO_RET = 'usu_rec_sent:';
/** Marca de quem o robô não vai chamar por um tempo (ou para sempre). Fora de BOT_SENT_PREFIXES e da faxina. */
export const PREFIXO_FORA_RET = 'usu_rec_fora:';
/** A vez de 10 min do robô: uma chave por faixa. Fora de BOT_SENT_PREFIXES (não é envio). */
export const PREFIXO_VEZ_RET = 'usu_rec_vez:';
export const CHAVE_PAUSA_RET = 'usu_rec_pausa';
export const CHAVE_LARGADA_RET = 'usu_rec_largada';
export const CHAVE_RESUMO_RET = 'usu_rec_resumo';

/** O carimbo de cada envio guarda `estado`; estes são os que o painel reconhece. A chave da sonda 1 não tem nenhum. */
export const ESTADOS_CARIMBO = ['reservado', 'enviado', 'incerto', 'nao_saiu', 'destino'] as const;
export type EstadoCarimbo = typeof ESTADOS_CARIMBO[number];

export const GRUPOS_TEXTO = ['pagou', 'nunca_pagou', 'incerto'] as const;
export type GrupoTexto = typeof GRUPOS_TEXTO[number];
export type Segmento = 'ex_assinante' | 'gratis_ativo' | 'gratis_cnpj' | 'gratis';

export const TETO_CAMPANHA_24H = 25;
/** A reserva do quiz (parecer do chefe-antiban, P4 antes de P5): a campanha para quando o frio da linha em 24 h chega ao teto frio menos isto (pico medido do quiz: 7 por dia). */
export const RESERVA_DO_QUIZ_24H = 8;
export const MAX_CARACTERES_RETOMADA = 160;
export const AVALIACOES_POR_RODADA = 8;

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
export const JANELA_TOQUE_RECENTE_MS = 14 * DIA;
export const JANELA_FALA_RECENTE_MS = 24 * HORA;
export const JANELA_MUDO_MS = 60 * DIA;
export const TOQUES_MUDO = 3;
export const JANELA_DOC_ATIVO_MS = 60 * DIA;
export const JANELA_NEXUS_MS = 24 * HORA;
/** documents.created_at vem 3 h adiantado (memória created-at-adiantado-3h). */
export const ADIANTO_DO_DOCUMENTO_MS = 3 * HORA;

/** A trava de ceder à agenda (D28): no máximo 4 carimbos da linha na hora; a env do teto da confirmação só aperta. */
export const CEDE_AGENDA_MAX = 4;
export const FOLGA_DA_AGENDA = 2;
export const TETO_CONFIRMA_PADRAO = 6;

/**
 * O PISO do 1º envio (D35). O orquestrador preenche na entrega: as 9h de Brasília (12:00Z) do 1º dia de janela depois do READY previsto e da
 * noite da sonda 1 (a condição do chefe-antiban). O executor NÃO escolhe a data. Enquanto isto não for uma data, o robô não envia nunca
 * (`sem_data_de_inicio`, a Central mostra Pausado): esse é o sinal de piso esquecido.
 */
export const INICIO_RETOMADA_ISO = 'PISO_NAO_PREENCHIDO';

/** Os telefones cadastrados do 5040 (a linha): quem tem esta chave é linha nossa, nunca público. */
export const TELEFONE_DA_LINHA_5040 = '5534998165040';

// ── os textos (redator, 31/10, aceitos pelo chefe-antiban) ───────────────────

const C = '{oi} Aqui é a Carla, da SolarDoc. Passando pra contar que a plataforma mudou bastante. Quer ver o que tem de novo?';

/**
 * Uma bolha, sem link, sem emoji, sem preço. `{oi}` vira "Oi, Ana." ou "Oi.". "Assinou" só no grupo `pagou`; "testou" só no `nunca_pagou`;
 * o `incerto` (ex-assinante sem pagamento provado) só recebe a C, que não afirma nada sobre a conta.
 */
export const VARIACOES_RETOMADA: Readonly<Record<GrupoTexto, readonly string[]>> = Object.freeze({
  // 04/11/2026: quem já pagou e saiu recebe a ENTREVISTA DE SAÍDA (pedido do dono), não a novidade. Uma pergunta só, sem link e sem {oi}
  // (o "Oi," já está no texto aprovado). O retomadaUsuarios.ts grava `entrevista_saida: true` na posse, e a Carla sabe que o toque foi este.
  pagou: Object.freeze([
    'Oi, aqui é a Carla, da SolarDoc. O que fez você parar de usar, ou o que faltou pra continuar?',
    'Carla aqui, da SolarDoc. Se pudesse mudar uma coisa na SolarDoc pra você ter ficado, qual seria?',
    'Oi, é a Carla, da SolarDoc. Pode ser sincero, não vou me ofender: o que pesou pra você sair?',
  ]),
  nunca_pagou: Object.freeze([
    '{oi} Aqui é a Carla, da SolarDoc. A plataforma mudou bastante desde que você testou. Quer ver o que tem de novo?',
    '{oi} Aqui é a Carla, da SolarDoc. Você testou a plataforma um tempo atrás, e ela mudou bastante. Quer ver o que tem de novo?',
    C,
  ]),
  incerto: Object.freeze([C]),
});

export type TextosPorGrupo = Readonly<Record<GrupoTexto, readonly string[]>>;

/** Algum dos três grupos está sem texto? É a trava global do robô (sem o texto do redator não envia). O parâmetro existe para o teste. */
export const textosVazios = (textos: TextosPorGrupo = VARIACOES_RETOMADA): boolean => GRUPOS_TEXTO.some(g => (textos[g] ?? []).length === 0);

/** "Oi, Ana." ou "Oi.". */
export const saudacao = (primeiro: string | null | undefined): string => {
  const p = String(primeiro ?? '').trim();
  return p ? `Oi, ${p}.` : 'Oi.';
};

/** Estável: o seco mostra a mensagem exata, e reavaliar a pessoa não troca o texto. */
export function variacaoDe(hmac: string, n: number): number {
  const v = parseInt(String(hmac ?? '').slice(0, 8), 16);
  return n > 0 && Number.isFinite(v) ? v % n : 0;
}

/** O que reprova um texto da retomada. Lista vazia = pode sair. */
export function motivosDoTexto(texto: string): string[] {
  const m: string[] = [];
  const t = String(texto ?? '');
  if (t.length > MAX_CARACTERES_RETOMADA) m.push('passa_de_160');
  if (/https?:|www\.|\.(?:com|app|br|net|org)\b/i.test(t)) m.push('link');
  if (/\p{Extended_Pictographic}/u.test(t)) m.push('emoji');
  if (/[—–]/.test(t)) m.push('travessao');
  if (!/^\p{Lu}/u.test(t)) m.push('sem_maiuscula_no_comeco');
  if ((t.match(/\?/g) ?? []).length !== 1) m.push('perguntas');
  if (/R\$|\bhoje\b/i.test(t)) m.push('preco_ou_hoje');
  if (/[{}]/.test(t)) m.push('modelo_sobrando');
  return m;
}

export type TextoDaRetomada =
  | { ok: true; texto: string; variacao: number }
  | { ok: false; motivo: 'sem_texto' | 'texto_invalido'; detalhe?: string[] };

/** O texto desta pessoa: pelo grupo, pela variação estável do hmac e pela saudação (o nome só entra se couber em 160). */
export function textoDaRetomada(
  grupo: GrupoTexto, primeiro: string | null | undefined, hmac: string, textos: TextosPorGrupo = VARIACOES_RETOMADA,
): TextoDaRetomada {
  const lista = textos[grupo] ?? [];
  if (!lista.length) return { ok: false, motivo: 'sem_texto' };
  const variacao = variacaoDe(hmac, lista.length);
  const modelo = lista[variacao]!;
  let texto = modelo.replace('{oi}', saudacao(primeiro));
  if (texto.length > MAX_CARACTERES_RETOMADA) texto = modelo.replace('{oi}', 'Oi.');
  const detalhe = motivosDoTexto(texto);
  if (detalhe.length) return { ok: false, motivo: 'texto_invalido', detalhe };
  return { ok: true, texto, variacao };
}

// ── o usuário e o que se sabe dele ───────────────────────────────────────────

export interface UsuarioRet {
  id: string;
  email?: string | null;
  nome?: string | null;
  whatsapp?: string | null;
  plano?: string | null;
  billing_status?: string | null;
  plano_expira_em?: string | null;
  created_at?: string | null;
  whatsapp_opt_out?: boolean | null;
  whatsapp_replied_at?: string | null;
  is_admin?: boolean | null;
  carla_sem_cnpj_count?: number | null;
  carla_inativo_count?: number | null;
  last_canceled_at?: string | null;
}

export interface VendaRet { email?: string | null; valor?: number | string | null; status?: string | null; subscription_id?: string | null }

export interface MarcaForaRet { motivo?: string; em?: string; ate?: string }

/** O que vem de FORA da linha de `users` (cada leitura é feita uma vez por rodada). */
export interface ExtrasRet {
  /** As vendas do e-mail da conta (sales). */
  vendas: readonly VendaRet[];
  /** O documento mais recente das últimas 60 dias, como veio do banco (3 h adiantado). null = nenhum. */
  ultimoDocumentoBrutoMs: number | null;
  temCnpj: boolean;
  /** `curso19:<user_id>.count`: toques da campanha do curso. */
  toquesCurso19: number;
  /** `nexus_convite_email:<user_id>.updated_at`. null = sem convite. */
  nexusConviteEmMs: number | null;
  jaNaCampanha: boolean;
  marcaFora: MarcaForaRet | null;
  /** `pesquisa_saida:<user_id>` existe: a pessoa já respondeu a entrevista de saída (formulário ou Carla). Ausente = não sei/não. */
  respondeuSaida?: boolean;
  /** `pesquisa_saida_email:<user_id>` foi tomado HOJE (dia de Brasília). Ausente = não. */
  emailSaidaHoje?: boolean;
}

export interface ContextoClassificar {
  agoraMs: number;
  /** Quando o robô largou (usu_rec_largada). Conta criada nesta hora ou depois fica fora. */
  largadaMs: number;
  /** Chaves (DDD + 8 dígitos) das linhas nossas: a 5040, os reservas, o dono e os consultores. */
  chavesDaCasa: ReadonlySet<string>;
  /** Chaves que aparecem em 2 ou mais contas de `users`. */
  repetidas: ReadonlySet<string>;
  /** HMAC da chave do telefone. null = sem segredo. */
  hmac: string | null;
}

export type MotivoDeFora =
  | 'sem_telefone' | 'sem_segredo' | 'telefone_fora_do_padrao' | 'admin_ou_teste' | 'linha_nossa' | 'paga_hoje' | 'opt_out'
  | 'depois_da_largada' | 'data_ilegivel' | 'telefone_em_mais_de_uma_conta' | 'mudo_antigo' | 'ja_na_campanha' | 'email_nexus_24h'
  | 'respondeu_pesquisa_saida' | 'email_saida_hoje'
  | `fora_marcado:${string}`;

export interface ItemDaFila {
  respondeu: boolean;
  segmento: Segmento;
  recencia: number | null;
  hmac: string;
}

export type Classificacao =
  | ({ ok: true; tel: string; chave: string; saiuEm: number | null; formaAntiga: 'cartao' | 'pix' | null; grupo: GrupoTexto } & ItemDaFila)
  | { ok: false; motivo: MotivoDeFora };

// ── telefone ─────────────────────────────────────────────────────────────────

/** As formas em que o telefone de uma chave de 10 dígitos aparece no banco. Cópia de caixaWhatsapp.variantesDaChave (um teste confere). */
export function variantesDaChaveRet(chave: string): string[] {
  if (!/^\d{10}$/.test(chave)) return [];
  const ddd = chave.slice(0, 2);
  const fim = chave.slice(2);
  return [`55${ddd}9${fim}`, `55${ddd}${fim}`, `${ddd}9${fim}`, `${ddd}${fim}`];
}

/** O telefone do cadastro e a chave dele. null = sem telefone de pessoa. */
export function telefoneDoUsuario(u: Pick<UsuarioRet, 'whatsapp'>): { tel: string; chave: string } | null {
  const tel = normalizarTelefoneSd(u.whatsapp);
  return tel ? { tel, chave: chaveDoTelefone(tel) } : null;
}

/** O valor de `users.whatsapp` é uma das formas que a resposta da pessoa vai casar? Sem isso a resposta não acha a conta. */
export function telefoneNoPadrao(u: Pick<UsuarioRet, 'whatsapp'>, chave: string): boolean {
  return variantesDaChaveRet(chave).includes(String(u.whatsapp ?? '').trim());
}

/** O conjunto de chaves das linhas nossas, a partir de telefones soltos (qualquer formato). */
export function montarChavesDaCasa(telefones: ReadonlyArray<string | null | undefined>): Set<string> {
  const s = new Set<string>();
  for (const t of telefones) {
    const n = normalizarTelefoneSd(t);
    if (n) s.add(chaveDoTelefone(n));
  }
  return s;
}

export const ehLinhaNossa = (chave: string, chavesDaCasa: ReadonlySet<string>): boolean => chavesDaCasa.has(chave);

/** Quais chaves aparecem em mais de uma conta (a situação da conta ficaria ambígua). */
export function chavesRepetidas(usuarios: ReadonlyArray<Pick<UsuarioRet, 'whatsapp'>>): Set<string> {
  const vistas = new Set<string>();
  const dobradas = new Set<string>();
  for (const u of usuarios) {
    const t = telefoneDoUsuario(u);
    if (!t) continue;
    if (vistas.has(t.chave)) dobradas.add(t.chave); else vistas.add(t.chave);
  }
  return dobradas;
}

/** Conta de admin, de teste ou de suporte (e-mail com "teste"/"test" ou da casa, nome com "teste"). */
export function ehContaDeTeste(u: Pick<UsuarioRet, 'is_admin' | 'email' | 'nome'>): boolean {
  if (u.is_admin === true) return true;
  const email = String(u.email ?? '');
  if (/(^|[._+-])(teste|test)([._+-]|@)|@solardoc\.app$/i.test(email)) return true;
  return /\bteste\b/i.test(String(u.nome ?? ''));
}

export const cnpjDe14 = (cnpj: unknown): boolean => String(cnpj ?? '').replace(/\D/g, '').length === 14;

// ── a conta: o que ela é hoje e o que foi ────────────────────────────────────

const ms = (v: unknown): number | null => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : null;
};
const temTexto = (v: unknown): boolean => String(v ?? '').trim() !== '';

/** Hoje paga ou está em cobrança: assinante recebe novidade pelo e-mail e pelo app, não por este robô. */
export function pagaHoje(u: Pick<UsuarioRet, 'plano' | 'billing_status' | 'plano_expira_em'>, agoraMs: number): boolean {
  if (u.plano !== 'free') return true;
  if (['active', 'trialing', 'past_due', 'unpaid', 'suspended'].includes(String(u.billing_status ?? ''))) return true;
  const expira = ms(u.plano_expira_em);
  return expira !== null && expira > agoraMs;
}

/**
 * Quando e como a conta SAIU. O `saiu_em` é o mais recente entre o `last_canceled_at` (o winback copia o `canceled_at` da Stripe: cartão) e o
 * `plano_expira_em` já vencido (Pix). NÃO usa o `updated_at` da venda: o syncStripePlans regrava `sales.updated_at` de toda venda a cada
 * rodada do /master, e o "saiu em" viraria "a última hora" para quem saiu há meses (parecer do chefe-antiban de 03/11).
 * `forma` é 'pix' quando a saída mais recente é o plano vencido, 'cartao' quando é o cancelamento e null quando não há data nenhuma.
 */
export function saidaDaConta(
  u: Pick<UsuarioRet, 'last_canceled_at' | 'plano_expira_em'>, agoraMs: number,
): { saiuEm: number | null; forma: 'cartao' | 'pix' | null } {
  const cancelou = ms(u.last_canceled_at);
  const expirou = ms(u.plano_expira_em);
  const vencido = expirou !== null && expirou < agoraMs ? expirou : null;
  if (cancelou === null && vencido === null) return { saiuEm: null, forma: null };
  if (vencido !== null && (cancelou === null || vencido > cancelou)) return { saiuEm: vencido, forma: 'pix' };
  return { saiuEm: cancelou, forma: 'cartao' };
}

/** Há pagamento PROVADO? Venda de status `paid` com valor maior que 0. Venda só com valor (teste) e plano vencido não provam (D29). */
export const provaDePagamento = (vendas: readonly VendaRet[]): boolean =>
  vendas.some(v => String(v.status ?? '') === 'paid' && Number(v.valor) > 0);

export interface SegmentoDaConta {
  segmento: Segmento;
  saiuEm: number | null;
  formaAntiga: 'cartao' | 'pix' | null;
  /** O critério de recência da fila: a saída (ex-assinante), o último documento (grátis ativo) ou a criação da conta. */
  recencia: number | null;
}

export function segmentoDaConta(
  u: Pick<UsuarioRet, 'last_canceled_at' | 'plano_expira_em' | 'created_at'>,
  x: Pick<ExtrasRet, 'vendas' | 'ultimoDocumentoBrutoMs' | 'temCnpj'>, agoraMs: number,
): SegmentoDaConta {
  const saida = saidaDaConta(u, agoraMs);
  const expirou = ms(u.plano_expira_em);
  const comVenda = x.vendas.some(v => Number(v.valor) > 0);
  if (temTexto(u.last_canceled_at) || (expirou !== null && expirou < agoraMs) || comVenda) {
    return { segmento: 'ex_assinante', saiuEm: saida.saiuEm, formaAntiga: saida.forma, recencia: saida.saiuEm };
  }
  const doc = x.ultimoDocumentoBrutoMs !== null ? x.ultimoDocumentoBrutoMs - ADIANTO_DO_DOCUMENTO_MS : null;
  if (doc !== null && agoraMs - doc <= JANELA_DOC_ATIVO_MS) return { segmento: 'gratis_ativo', saiuEm: null, formaAntiga: null, recencia: doc };
  const criada = ms(u.created_at);
  return { segmento: x.temCnpj ? 'gratis_cnpj' : 'gratis', saiuEm: null, formaAntiga: null, recencia: criada };
}

/** Os três segmentos grátis são `nunca_pagou`; o ex-assinante com pagamento provado é `pagou`; o sem prova é `incerto`. */
export function grupoDoTexto(segmento: Segmento, prova: boolean): GrupoTexto {
  if (segmento !== 'ex_assinante') return 'nunca_pagou';
  return prova ? 'pagou' : 'incerto';
}

// ── a classificação (as exclusões, na ordem) ─────────────────────────────────

/**
 * Quem entra e quem fica fora, com o PRIMEIRO motivo que vale. A ordem é a do plano (5.2):
 * telefone, telefone no padrão, admin/teste, linha nossa, paga hoje, opt-out, depois da largada, telefone repetido, mudo antigo,
 * já na campanha, marcado fora, convite da NEXUS nas últimas 24 h.
 */
export function classificarUsuario(u: UsuarioRet, x: ExtrasRet, ctx: ContextoClassificar): Classificacao {
  const t = telefoneDoUsuario(u);
  if (!t) return { ok: false, motivo: 'sem_telefone' };
  if (!ctx.hmac) return { ok: false, motivo: 'sem_segredo' };
  if (!telefoneNoPadrao(u, t.chave)) return { ok: false, motivo: 'telefone_fora_do_padrao' };
  if (ehContaDeTeste(u)) return { ok: false, motivo: 'admin_ou_teste' };
  if (ehLinhaNossa(t.chave, ctx.chavesDaCasa)) return { ok: false, motivo: 'linha_nossa' };
  if (pagaHoje(u, ctx.agoraMs)) return { ok: false, motivo: 'paga_hoje' };
  if (u.whatsapp_opt_out === true) return { ok: false, motivo: 'opt_out' };
  const criada = ms(u.created_at);
  if (criada === null) return { ok: false, motivo: 'data_ilegivel' };
  if (criada >= ctx.largadaMs) return { ok: false, motivo: 'depois_da_largada' };
  if (ctx.repetidas.has(t.chave)) return { ok: false, motivo: 'telefone_em_mais_de_uma_conta' };
  const toques = (Number(u.carla_sem_cnpj_count) || 0) + (Number(u.carla_inativo_count) || 0) + (Number(x.toquesCurso19) || 0);
  if (!temTexto(u.whatsapp_replied_at) && toques >= TOQUES_MUDO) return { ok: false, motivo: 'mudo_antigo' };
  if (x.jaNaCampanha) return { ok: false, motivo: 'ja_na_campanha' };
  if (x.marcaFora) {
    const ate = x.marcaFora.ate === undefined ? null : ms(x.marcaFora.ate);
    // Sem `ate` vale para sempre; `ate` ilegível também (na dúvida, fica fora).
    if (x.marcaFora.ate === undefined || ate === null || ate > ctx.agoraMs) {
      return { ok: false, motivo: `fora_marcado:${String(x.marcaFora.motivo ?? 'sem_motivo').slice(0, 60)}` };
    }
  }
  if (x.nexusConviteEmMs !== null && ctx.agoraMs - x.nexusConviteEmMs < JANELA_NEXUS_MS) return { ok: false, motivo: 'email_nexus_24h' };

  const s = segmentoDaConta(u, x, ctx.agoraMs);
  const grupo = grupoDoTexto(s.segmento, provaDePagamento(x.vendas));
  // A entrevista de saída (04/11/2026) é só do grupo `pagou`: quem já respondeu o formulário não leva a mesma pergunta pelo WhatsApp, e o
  // WhatsApp não sai no mesmo dia do e-mail de saída.
  if (grupo === 'pagou' && x.respondeuSaida === true) return { ok: false, motivo: 'respondeu_pesquisa_saida' };
  if (grupo === 'pagou' && x.emailSaidaHoje === true) return { ok: false, motivo: 'email_saida_hoje' };
  return {
    ok: true, tel: t.tel, chave: t.chave, hmac: ctx.hmac,
    segmento: s.segmento, grupo,
    saiuEm: s.saiuEm, formaAntiga: s.formaAntiga, recencia: s.recencia,
    respondeu: temTexto(u.whatsapp_replied_at),
  };
}

// ── a ordem ──────────────────────────────────────────────────────────────────

const RANK_SEGMENTO: Readonly<Record<Segmento, number>> = { ex_assinante: 0, gratis_ativo: 1, gratis_cnpj: 2, gratis: 3 };

/** 0 = ex-assinante que já respondeu; 1 = os outros que já responderam; 2 = quem nunca respondeu. */
export const faixaDe = (i: Pick<ItemDaFila, 'respondeu' | 'segmento'>): 0 | 1 | 2 =>
  i.respondeu ? (i.segmento === 'ex_assinante' ? 0 : 1) : 2;

/** Faixa, depois segmento, depois recência decrescente (sem data por último), depois o hmac crescente. Não altera a lista de entrada. */
export function ordenarFila<T extends ItemDaFila>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    const f = faixaDe(a) - faixaDe(b);
    if (f) return f;
    const s = RANK_SEGMENTO[a.segmento] - RANK_SEGMENTO[b.segmento];
    if (s) return s;
    const ra = a.recencia ?? -Infinity;
    const rb = b.recencia ?? -Infinity;
    if (ra !== rb) return rb > ra ? 1 : -1;
    return a.hmac < b.hmac ? -1 : a.hmac > b.hmac ? 1 : 0;
  });
}

// ── a conversa (o que já foi dito a esta pessoa) ─────────────────────────────

const quando = (m: Pick<MsgConversa, 'momment'>): number => {
  const t = Date.parse(String(m.momment ?? ''));
  return Number.isFinite(t) ? t : 0;
};

/** O instante da última mensagem NOSSA (robô ou gente da equipe), ou null. */
export function toqueNossoMaisRecente(msgs: readonly Pick<MsgConversa, 'autor' | 'momment'>[]): number | null {
  let r: number | null = null;
  for (const m of msgs) if (m.autor !== 'lead') { const t = quando(m); if (r === null || t > r) r = t; }
  return r;
}

/** O instante da última fala do LEAD, ou null. */
export function falaDoLeadMaisRecente(msgs: readonly Pick<MsgConversa, 'autor' | 'momment'>[]): number | null {
  let r: number | null = null;
  for (const m of msgs) if (m.autor === 'lead') { const t = quando(m); if (r === null || t > r) r = t; }
  return r;
}

/** Mudo pela conversa: em 60 dias, 3 ou mais mensagens nossas e nenhuma do lead; ou, na conversa inteira, o mesmo. */
export function mudoPelaConversa(msgs: readonly Pick<MsgConversa, 'autor' | 'momment'>[], agoraMs: number): boolean {
  const conta = (so60: boolean): { nossas: number; lead: number } => {
    let nossas = 0; let lead = 0;
    for (const m of msgs) {
      if (so60 && agoraMs - quando(m) > JANELA_MUDO_MS) continue;
      if (m.autor === 'lead') lead++; else nossas++;
    }
    return { nossas, lead };
  };
  const a = conta(true);
  const b = conta(false);
  return (a.nossas >= TOQUES_MUDO && a.lead === 0) || (b.nossas >= TOQUES_MUDO && b.lead === 0);
}

export type MotivoDaConversa = 'toque_recente_14d' | 'falou_nas_24h' | 'mudo_pela_conversa';

/** O primeiro motivo da conversa que tira a pessoa da rodada (5.4, linhas 6 a 8), com os instantes que a marca usa. */
export function motivoDaConversa(
  msgs: readonly Pick<MsgConversa, 'autor' | 'momment'>[], agoraMs: number,
): { motivo: MotivoDaConversa; toqueMs?: number; falaMs?: number } | null {
  const toque = toqueNossoMaisRecente(msgs);
  if (toque !== null && agoraMs - toque <= JANELA_TOQUE_RECENTE_MS) return { motivo: 'toque_recente_14d', toqueMs: toque };
  const fala = falaDoLeadMaisRecente(msgs);
  if (fala !== null && agoraMs - fala <= JANELA_FALA_RECENTE_MS) return { motivo: 'falou_nas_24h', falaMs: fala };
  if (mudoPelaConversa(msgs, agoraMs)) return { motivo: 'mudo_pela_conversa' };
  return null;
}

// ── as marcas (`usu_rec_fora:<hmac>`) ────────────────────────────────────────

/**
 * O que gravar em `usu_rec_fora` quando a pessoa é barrada na avaliação. `{}` = para sempre (sem `ate`); `{ ate }` = até a data;
 * null = não marca (leitura que falhou, motivos da própria rodada, adiamentos).
 */
export function marcaDoMotivo(
  motivo: string, agoraMs: number, extra: { toqueMs?: number; falaMs?: number } = {},
): { ate?: string } | null {
  const ate = (t: number): { ate: string } => ({ ate: new Date(t).toISOString() });
  if (motivo === 'suprimido' || motivo === 'bloqueado' || motivo === 'numero_de_teste') return ate(agoraMs + 30 * DIA);
  if (motivo.startsWith('posse_existente:')) return ate(agoraMs + 7 * DIA);
  if (motivo === 'toque_recente_14d') return ate((extra.toqueMs ?? agoraMs) + JANELA_TOQUE_RECENTE_MS);
  if (motivo === 'falou_nas_24h') return ate((extra.falaMs ?? agoraMs) + JANELA_FALA_RECENTE_MS);
  if (motivo === 'mudo_pela_conversa' || motivo === 'sem_whatsapp') return {};
  if (motivo === 'humano_na_conversa') return ate(agoraMs + DIA);
  if (motivo === 'outro_robo') return ate(agoraMs + 3 * DIA);
  if (motivo === 'reuniao_ativa') return ate(agoraMs + 7 * DIA);
  if (motivo === 'telefone_nao_casa_com_a_conta') return ate(agoraMs + 7 * DIA);
  return null;
}

// ── a agenda primeiro (D28) ──────────────────────────────────────────────────

/**
 * Quantos carimbos da LINHA INTEIRA na última hora fazem a campanha ceder à agenda. A confirmação de ficha atrasada só sai com a linha
 * abaixo de EP_CONFIRMA_TETO_HORA (padrão 6) na hora; a campanha deixa 2 vagas para ela e nunca passa de 4. Env ilegível vale 6, então o
 * limite fica em 4 e a env só aperta. Mesma leitura de io/eletropostoAgenda.ts: Number(env || 6).
 */
export function limiteCedeAAgenda(valorDaEnv: string | undefined): number {
  const v = Number(valorDaEnv || TETO_CONFIRMA_PADRAO);
  const teto = Number.isFinite(v) && v > 0 ? Math.floor(v) : TETO_CONFIRMA_PADRAO;
  return Math.max(0, Math.min(CEDE_AGENDA_MAX, teto - FOLGA_DA_AGENDA));
}

// ── o início (D35) ───────────────────────────────────────────────────────────

const TRES_H = 3 * HORA;

/** Dia útil para mensagem fria: segunda a sábado, fora de feriado nacional. Mesma conta de dentroDaJanelaDaBaseLinha. */
const diaDeJanela = (instante: number): boolean => {
  const dow = diaDaSemanaBRT(instante);
  return dow >= 1 && dow <= 6 && !ehFeriadoBR(diaBRT(instante));
};

/**
 * O 1º instante em que o robô pode enviar: o MAIOR entre o piso e as 9h de Brasília do 1º dia de janela depois do dia (de Brasília) da
 * largada. A largada é gravada na 1ª rodada depois do deploy, então nunca sai envio no dia do deploy, e entre o READY e o 1º envio
 * sempre fica uma noite (onde roda a sonda 1). Piso ou largada que não são número, ou 7 dias sem achar janela, valem Infinity: nunca.
 */
export function inicioEfetivoMs(largadaMs: number, pisoMs: number): number {
  if (!Number.isFinite(largadaMs) || !Number.isFinite(pisoMs)) return Infinity;
  let dia = diaBRT(largadaMs);
  if (!dia) return Infinity;
  for (let i = 0; i < 7; i++) {
    dia = new Date(Date.parse(`${dia}T00:00:00.000Z`) + DIA).toISOString().slice(0, 10);
    const noveHoras = Date.parse(`${dia}T09:00:00.000Z`) + TRES_H;     // 9h de Brasília
    if (diaDeJanela(noveHoras)) return Math.max(pisoMs, noveHoras);
  }
  return Infinity;
}

/** O piso do código como número. Texto que não é data vale NaN (e o início, Infinity). */
export const pisoDoCodigoMs = (iso: string = INICIO_RETOMADA_ISO): number => Date.parse(iso);

/** "DD/MM" de Brasília, ou null quando o instante não é número. */
export function inicioEmTexto(msInicio: number): string | null {
  if (!Number.isFinite(msInicio)) return null;
  const d = diaBRT(msInicio);
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : null;
}

/** "9h" ou "9h30" de Brasília. */
const horaEmTexto = (msInicio: number): string => {
  const h = horaBRT(msInicio);
  const min = new Date(msInicio - TRES_H).getUTCMinutes();
  return min ? `${h}h${String(min).padStart(2, '0')}` : `${h}h`;
};

// ── o motivo de a campanha estar parada (painel e Central) ───────────────────

export interface ParadaRet { motivo: string; texto: string; bloqueio: boolean }

const PARADAS: Readonly<Record<string, { texto: string; bloqueio: boolean }>> = Object.freeze({
  sem_texto: { texto: 'Sem o texto do redator: não envia', bloqueio: true },
  carla_nao_atende_todos: { texto: 'A Carla não está atendendo todos: a resposta cairia na Giovanna', bloqueio: true },
  ia_parada: { texto: 'A IA está parada: não envia', bloqueio: true },
  linha_pausada: { texto: 'A linha está pausada por erros', bloqueio: true },
  sem_data_de_inicio: { texto: 'Sem data de início: não envia', bloqueio: true },
  leitura_falhou: { texto: 'Não consegui ler o estado da retomada', bloqueio: true },
  fora_da_janela: { texto: 'Fora da janela: segunda a sábado, das 9h às 20h, fora de feriado', bloqueio: false },
  teto_da_campanha: { texto: `Teto de ${TETO_CAMPANHA_24H} em 24 horas atingido`, bloqueio: false },
  reserva_do_quiz: { texto: 'O frio da linha está perto do teto: a campanha deixa a vaga para o quiz', bloqueio: false },
  teto_da_linha: { texto: 'O envio frio da linha está cheio agora', bloqueio: false },
  cede_a_agenda: { texto: 'A agenda está usando a linha: o frio espera', bloqueio: false },
});

/** Estrutura trava (bloqueio: a Central mostra Pausado); horário, teto e agenda só explicam (a Central segue Ligada). */
export function paradaDoMotivo(motivo: string, opts: { inicioMs?: number } = {}): ParadaRet | null {
  if (motivo === 'antes_do_inicio') {
    const dia = inicioEmTexto(opts.inicioMs ?? NaN);
    if (!dia) return { motivo, texto: PARADAS.sem_data_de_inicio!.texto, bloqueio: true };
    return { motivo, texto: `Começa em ${dia} às ${horaEmTexto(opts.inicioMs as number)}`, bloqueio: false };
  }
  const p = PARADAS[motivo];
  return p ? { motivo, texto: p.texto, bloqueio: p.bloqueio } : null;
}

/** A vez de 10 min: uma chave por faixa do relógio. */
export const chaveVezRet = (agora: Date): string => `${PREFIXO_VEZ_RET}${Math.floor(agora.getTime() / (10 * MIN))}`;

/** O carimbo `usu_rec_sent:` tem a forma que o painel reconhece (estado conhecido e user_id)? A chave da sonda 1 não tem. */
export function carimboReconhecido(valor: unknown): valor is { estado: EstadoCarimbo; user_id: string; em?: string } {
  const v = valor as { estado?: unknown; user_id?: unknown } | null | undefined;
  return !!v && typeof v === 'object'
    && (ESTADOS_CARIMBO as readonly string[]).includes(String(v.estado)) && typeof v.user_id === 'string' && v.user_id !== '';
}

/**
 * O e-mail da conta com o meio coberto, para a Carla dizer qual e-mail usar no Pix sem escrever o endereço inteiro (jo***@gmail.com).
 * Mostra até 2 letras do começo (1 se o começo é curto), `***` e o domínio. Sem `@` ou sem as duas partes = null.
 */
export function mascararEmail(email: unknown): string | null {
  const e = String(email ?? '').trim().toLowerCase();
  const i = e.lastIndexOf('@');
  if (i < 1 || i === e.length - 1) return null;
  const local = e.slice(0, i);
  const dominio = e.slice(i + 1);
  if (/\s/.test(e) || !dominio.includes('.')) return null;
  const ini = local.length <= 3 ? local.slice(0, 1) : local.slice(0, 2);
  return `${ini}***@${dominio}`;
}
