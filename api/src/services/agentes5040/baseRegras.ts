// ─────────────────────────────────────────────────────────────────────────────
// AS REGRAS DA BASE DAS AGENTES (B4b): retomada fria e estacionado. PURO: sem banco, sem rede, sem IA e sem envio.
// Quem executa é o baseEnvio.ts (a rodada de 10 min, o único que importa o zapiClient) e o vivo.ts (a ação `estacionar`,
// que só chama as funções daqui). Por isso este arquivo existe: o vivo.ts não pode importar o baseEnvio.ts.
//
// O que a Base faz: a Duda (solar) e a Helena (eletroposto) voltam, UMA vez por rodada, em quem parou de responder.
//   · alvo: posse viva de dona ligada e no escopo, SEM card do produto (qualquer status) e sem card ativo do outro
//     produto, última mensagem da conversa NOSSA (feita pela própria agente) e lead calado há 3 h ou mais;
//   · no máximo 2 retomadas por pessoa, contando o envio real (carimbos ag5040_retomada:<hmac>:<n>, que mandam sobre
//     lead_data.base.retomadas). A 2ª só no dia seguinte (Brasília), 3 h depois da 1ª e sem o lead ter respondido;
//   · janela de 9h às 20h, segunda a sábado (fixa, de propósito: as chaves JANELA_* da linha não alargam a Base);
//   · estacionado: o PRÓPRIO lead disse "agora não" ou "me chama em <data>". Com data dita, lead_data.base.estacionado_ate
//     é a data às 9h de Brasília; "agora não" sem data = prazo fixo de 30 dias e esta é a ÚLTIMA retomada. No dia sai 1
//     retomada (conta nas 2); domingo cai na segunda pela janela. "Não quero", "para", "não me chama" NUNCA estacionam.
//
// Telefone cru nunca entra aqui: as funções recebem ids, horários e textos já lidos.
// ─────────────────────────────────────────────────────────────────────────────

import { ehFeriadoBR } from '../../utils/feriadosBR';
import { diaBRT, diaDaSemanaBRT, horaBRT, type Instante } from './relogio';
import { semAcento } from './trava';

export const PREFIXO_RETOMADA = 'ag5040_retomada:';
export const PREFIXO_VEZ_BASE = 'ag5040_base_vez:';
export const CHAVE_FILA_BASE = 'ag5040_base_fila';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export const LIMITES_BASE = Object.freeze({
  /** O lead calado há pelo menos isto (desde a última mensagem da conversa) entra na fila. */
  silencioMs: 3 * HORA_MS,
  maxRetomadas: 2,
  janelaDe: 9,
  janelaAte: 20,
  /** A vez da rodada é um insert por faixa de 10 minutos. */
  faixaVezMs: 10 * 60_000,
  /** Resposta ao vivo (ag5040_sent:) há menos disto: a Base espera. */
  respostaVivaMs: 2 * 60_000,
  /** Conversa cuja última mensagem é mais velha que isto não é retomada (a não ser no dia do estacionado). */
  idadeMaxMs: 48 * HORA_MS,
  /** Tentativa que não terminou em envio (IA parou, espaçamento depois da IA): a mesma conversa espera isto. */
  tentativaTransitoriaMs: 30 * 60_000,
  /** Conversas avaliadas por rodada (lê conversa, cartões, listas). */
  avaliacoesPorRodada: 30,
  estacionadoFixoDias: 30,
  estacionadoMaxDias: 180,
  /** Carimbo de outro robô no mesmo telefone nas últimas 24 h. */
  carimbosOutrosMs: DIA_MS,
  /** Posses mexidas há mais disto não entram na leitura (as estacionadas entram por outra consulta). */
  posseJanelaMs: 72 * HORA_MS,
});

// ── janela, vez e chaves ─────────────────────────────────────────────────────

/** 9h às 20h (a hora cheia 19 ainda vale), segunda a sábado, fora de feriado nacional, em Brasília, fixos. Instante inválido = false. */
export function dentroDaJanelaBase(agora: Instante): boolean {
  const dow = diaDaSemanaBRT(agora);
  const h = horaBRT(agora);
  if (dow < 1 || dow > 6 || h < 0) return false;
  if (ehFeriadoBR(diaBRT(agora))) return false;
  return h >= LIMITES_BASE.janelaDe && h < LIMITES_BASE.janelaAte;
}

/** A faixa de 10 minutos (UTC) da vez da rodada: "2026-10-21T14:30". */
export function faixaDaVez(agora: Date): string {
  const ms = Math.floor(agora.getTime() / LIMITES_BASE.faixaVezMs) * LIMITES_BASE.faixaVezMs;
  return new Date(ms).toISOString().slice(0, 16);
}

export const chaveVezBase = (agora: Date): string => `${PREFIXO_VEZ_BASE}${faixaDaVez(agora)}`;
export const chaveRetomada = (hmac: string, n: number): string => `${PREFIXO_RETOMADA}${hmac}:${n}`;

// ── lead_data.base ───────────────────────────────────────────────────────────

/** A tentativa que não terminou em envio, presa à última mensagem da conversa (id) para não repetir a IA sem mensagem nova. */
export interface TentativaBase { wa_id: number; em: string; motivo: string; permanente: boolean }

export interface BaseDaPosse {
  /** Quantas retomadas saíram (envio real). */
  retomadas: number;
  ultima_retomada_em: string | null;
  /** ISO (9h de Brasília) até quando a pessoa fica estacionada; null = não está. */
  estacionado_ate: string | null;
  estacionado_motivo: string | null;
  /** O prazo foi o fixo de 30 dias: a retomada do dia é a última (fecha nas 2). */
  ultima: boolean;
  tentativa: TentativaBase | null;
}

const iso = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v : '';
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};

/** Lê lead_data.base sem confiar em nada: campo ausente ou torto vira o valor neutro. */
export function lerBaseDaPosse(posse: Record<string, unknown> | null | undefined): BaseDaPosse {
  const b = posse && typeof posse.base === 'object' && posse.base !== null && !Array.isArray(posse.base)
    ? posse.base as Record<string, unknown> : {};
  const n = Number(b.retomadas);
  const t = b.tentativa && typeof b.tentativa === 'object' ? b.tentativa as Record<string, unknown> : null;
  const tentativa: TentativaBase | null = t && Number.isFinite(Number(t.wa_id)) && iso(t.em)
    ? { wa_id: Number(t.wa_id), em: String(t.em), motivo: String(t.motivo ?? '').slice(0, 60), permanente: t.permanente === true }
    : null;
  return {
    retomadas: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    ultima_retomada_em: iso(b.ultima_retomada_em),
    estacionado_ate: iso(b.estacionado_ate),
    estacionado_motivo: typeof b.estacionado_motivo === 'string' ? b.estacionado_motivo.slice(0, 40) : null,
    ultima: b.ultima === true,
    tentativa,
  };
}

/**
 * O novo `base` para gravar na posse: o que já existia (inclusive campos de outras peças) com o patch por cima. Existe
 * porque atualizarPosse junta raso: gravar `{ base: patch }` apagaria `retomadas`.
 */
export function juntarBase(posse: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const atual = posse && typeof posse.base === 'object' && posse.base !== null && !Array.isArray(posse.base)
    ? posse.base as Record<string, unknown> : {};
  return { ...atual, ...patch };
}

// ── triagem 1: só a posse (barata, sem ler a conversa) ───────────────────────

export type MotivoBase =
  | 'duas_retomadas_feitas' | 'estacionado' | 'tentativa_sem_mensagem_nova' | 'conversa_incompleta' | 'lead_nunca_falou'
  | 'lead_escreveu_por_ultimo' | 'equipe_falou_por_ultimo' | 'humano_na_conversa' | 'calado_ha_menos_de_3h' | 'conversa_velha'
  | 'outro_robo_falou' | 'carimbo_de_outro_robo_24h' | 'tem_card_do_produto' | 'tem_card_do_outro_produto' | 'segunda_ainda_nao'
  | 'lead_respondeu_a_primeira' | 'sem_telefone' | 'lead_ja_e_cliente' | 'opt_out_ou_bloqueio' | 'mudo' | 'outro_robo_ativo'
  | 'leitura_falhou' | 'fora_do_escopo' | 'dona_desligada';

export type Triagem = { ok: true; viaEstacionado: boolean } | { ok: false; motivo: MotivoBase };

/**
 * Posse: já fez as 2? está estacionada? já tentou nesta mesma última mensagem? A tentativa PERMANENTE (a IA decidiu não
 * retomar, a trava barrou) só some com mensagem nova; a transitória some em 30 minutos. A comparação com a última
 * mensagem é feita na triagem 2 (precisa da conversa); aqui só o que a posse sozinha responde.
 */
export function triagemDaPosse(base: BaseDaPosse, agoraMs: number): Triagem {
  if (base.retomadas >= LIMITES_BASE.maxRetomadas) return { ok: false, motivo: 'duas_retomadas_feitas' };
  const ate = base.estacionado_ate ? Date.parse(base.estacionado_ate) : NaN;
  if (Number.isFinite(ate) && ate > agoraMs) return { ok: false, motivo: 'estacionado' };
  return { ok: true, viaEstacionado: Number.isFinite(ate) };
}

// ── triagem 2: a conversa ────────────────────────────────────────────────────

export interface MsgResumo { id: number; autor: 'lead' | 'robo' | 'equipe'; momment: string }

export interface ResumoConversa {
  lastLead: { id: number; momment: string } | null;
  last: { id: number; autor: 'lead' | 'robo' | 'equipe'; momment: string } | null;
  /** Mensagens de robô depois da última fala do lead. */
  roboAposLead: number;
  equipeAposLead: boolean;
}

/** `msgs` da mais antiga para a mais nova. */
export function resumirConversa(msgs: readonly MsgResumo[]): ResumoConversa {
  let iLead = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]!.autor === 'lead') { iLead = i; break; }
  const depois = iLead >= 0 ? msgs.slice(iLead + 1) : [];
  const ultima = msgs[msgs.length - 1] ?? null;
  const l = iLead >= 0 ? msgs[iLead]! : null;
  return {
    lastLead: l ? { id: l.id, momment: l.momment } : null,
    last: ultima ? { id: ultima.id, autor: ultima.autor, momment: ultima.momment } : null,
    roboAposLead: depois.filter(m => m.autor === 'robo').length,
    equipeAposLead: depois.some(m => m.autor === 'equipe'),
  };
}

export function triagemDaConversa(r: ResumoConversa, base: BaseDaPosse, via: boolean, agoraMs: number): { ok: true } | { ok: false; motivo: MotivoBase } {
  if (!r.lastLead || !r.last) return { ok: false, motivo: 'lead_nunca_falou' };
  if (r.last.autor === 'lead') return { ok: false, motivo: 'lead_escreveu_por_ultimo' };
  if (r.last.autor === 'equipe' || r.equipeAposLead) return { ok: false, motivo: 'equipe_falou_por_ultimo' };
  const t = base.tentativa;
  if (t && t.wa_id === r.last.id && (t.permanente || agoraMs - Date.parse(t.em) < LIMITES_BASE.tentativaTransitoriaMs)) {
    return { ok: false, motivo: 'tentativa_sem_mensagem_nova' };
  }
  const quando = Date.parse(r.last.momment);
  if (!Number.isFinite(quando)) return { ok: false, motivo: 'leitura_falhou' };
  const idade = agoraMs - quando;
  if (idade < LIMITES_BASE.silencioMs) return { ok: false, motivo: 'calado_ha_menos_de_3h' };
  if (!via && idade > LIMITES_BASE.idadeMaxMs) return { ok: false, motivo: 'conversa_velha' };
  return { ok: true };
}

// ── triagem 3: carimbos, cartões, listas ─────────────────────────────────────

export interface CarimboProprio { n: number; em: string }

export interface FatosDoContexto {
  /** Cartão do produto da dona (qualquer status). */
  cardDoProduto: boolean;
  /** Cartão do outro produto que não está cancelado (a régua do outro produto pode estar ativa). */
  cardAtivoDoOutroProduto: boolean;
  /** lerFatosPorteiro em modo estrito. */
  leituraOk: boolean;
  humanoNaConversa: boolean;
  silenciado: boolean;
  bloqueado: boolean;
  mudo: boolean;
  outroRoboAtivo: boolean;
  ehClienteSolarDoc: boolean;
  /** Carimbos da própria agente que explicam mensagens depois da última fala do lead: ag5040_sent:<waId>:1/:2. */
  respostasDaAgenteAposLead: number;
  /** ag5040_retomada:<hmac>:* (todos, com a hora). */
  retomadasCarimbadas: readonly CarimboProprio[];
  /** Carimbo de outro robô, amarrado ao telefone, nas últimas 24 h. */
  carimboDeOutroRobo24h: boolean;
  telefoneResolvido: boolean;
}

export type Veredito = { ok: true; n: number } | { ok: false; motivo: MotivoBase };

/** A última triagem: junta tudo e dá o número da retomada (1 ou 2). */
export function triagemDoContexto(
  f: FatosDoContexto, r: ResumoConversa, base: BaseDaPosse, via: boolean, agoraMs: number,
): Veredito {
  if (!f.leituraOk) return { ok: false, motivo: 'leitura_falhou' };
  if (!r.lastLead) return { ok: false, motivo: 'lead_nunca_falou' };
  const feitas = Math.max(base.retomadas, f.retomadasCarimbadas.length);
  if (feitas >= LIMITES_BASE.maxRetomadas) return { ok: false, motivo: 'duas_retomadas_feitas' };
  if (f.cardDoProduto) return { ok: false, motivo: 'tem_card_do_produto' };
  if (f.cardAtivoDoOutroProduto) return { ok: false, motivo: 'tem_card_do_outro_produto' };
  if (f.ehClienteSolarDoc) return { ok: false, motivo: 'lead_ja_e_cliente' };
  if (f.humanoNaConversa) return { ok: false, motivo: 'humano_na_conversa' };
  if (f.silenciado || f.bloqueado) return { ok: false, motivo: 'opt_out_ou_bloqueio' };
  if (f.mudo) return { ok: false, motivo: 'mudo' };
  if (f.outroRoboAtivo) return { ok: false, motivo: 'outro_robo_ativo' };
  // Toda mensagem de robô depois da fala do lead tem que ser da própria agente (resposta ou retomada anterior).
  const retomadasDepois = f.retomadasCarimbadas.filter(c => Date.parse(c.em) >= Date.parse(r.lastLead!.momment)).length;
  if (r.roboAposLead < 1 || r.roboAposLead > f.respostasDaAgenteAposLead + retomadasDepois) return { ok: false, motivo: 'outro_robo_falou' };
  if (f.carimboDeOutroRobo24h) return { ok: false, motivo: 'carimbo_de_outro_robo_24h' };
  if (!f.telefoneResolvido) return { ok: false, motivo: 'sem_telefone' };
  const n = feitas + 1;
  if (n >= 2 && !via) {
    const primeira = f.retomadasCarimbadas.find(c => c.n === 1)?.em ?? base.ultima_retomada_em;
    const pMs = primeira ? Date.parse(primeira) : NaN;
    if (!Number.isFinite(pMs)) return { ok: false, motivo: 'segunda_ainda_nao' };
    if (Date.parse(r.lastLead.momment) > pMs) return { ok: false, motivo: 'lead_respondeu_a_primeira' };
    if (diaBRT(agoraMs) <= diaBRT(pMs) || agoraMs - pMs < LIMITES_BASE.silencioMs) return { ok: false, motivo: 'segunda_ainda_nao' };
  }
  return { ok: true, n };
}

/** O patch de `base` depois de uma retomada que SAIU. A do estacionado fecha a conta quando o prazo foi o fixo. */
export function patchDepoisDaRetomada(base: BaseDaPosse, n: number, via: boolean, agora: Date): Record<string, unknown> {
  const fecha = via && base.ultima;
  return {
    retomadas: fecha ? LIMITES_BASE.maxRetomadas : Math.max(n, base.retomadas + 1),
    ultima_retomada_em: agora.toISOString(),
    ...(via ? { estacionado_ate: null, estacionado_voltou_em: agora.toISOString() } : {}),
    tentativa: null,
  };
}

// ── a bolha da retomada ──────────────────────────────────────────────────────

export type DecisaoDaBolha =
  | { tipo: 'texto'; bolha: string }
  | { tipo: 'nao_retomar'; motivo: string }
  | { tipo: 'barrada'; motivo: string };

interface SaidaMinima { acao: string; bolhas: readonly string[]; peca: unknown | null }

/**
 * O que a IA devolveu na retomada: UMA bolha de até 160 caracteres, ação continuar, sem peça, sem link, sem Pix, sem
 * travessão. `calar` (bolhas vazias) é a IA decidindo não retomar. Qualquer outra coisa não sai.
 */
export function decidirBolhaDaRetomada(s: SaidaMinima): DecisaoDaBolha {
  if (s.acao === 'calar') return { tipo: 'nao_retomar', motivo: 'ia_disse_nao' };
  if (s.acao !== 'continuar') return { tipo: 'barrada', motivo: `acao:${String(s.acao).slice(0, 30)}` };
  if (s.peca) return { tipo: 'barrada', motivo: 'peca' };
  if (s.bolhas.length !== 1) return { tipo: 'barrada', motivo: `bolhas:${s.bolhas.length}` };
  const b = String(s.bolhas[0] ?? '').trim();
  if (!b) return { tipo: 'nao_retomar', motivo: 'bolha_vazia' };
  if (b.length > 160) return { tipo: 'barrada', motivo: 'passa_de_160' };
  if (/[—–]/.test(b)) return { tipo: 'barrada', motivo: 'travessao' };
  if (b.includes('||')) return { tipo: 'barrada', motivo: 'separador' };
  if (/https?:\/\/|www\./i.test(b) || /^000201/.test(b)) return { tipo: 'barrada', motivo: 'link_ou_pix' };
  return { tipo: 'texto', bolha: b };
}

// ── estacionar ───────────────────────────────────────────────────────────────

const P2 = (n: number): string => String(n).padStart(2, '0');

/** O lead está pedindo para parar? ("não quero", "para", "não me chama", "sai da lista"...). Estacionar nunca vale aqui. */
export function pareceOptOut(textos: readonly string[]): boolean {
  for (const bruto of textos) {
    const t = semAcento(bruto).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/^(?:pa(?:ra|re)|chega|parar|stop|sair)[\s.!]*$/.test(t)) return true;
    if (/\bpa(?:ra|re)\s+de\s+(?:me\s+)?(?:mandar|enviar|chamar|escrever|ligar|falar|insistir|incomodar|perturbar)/.test(t)) return true;
    if (/\bnao\s+(?:quero|tenho\s+interesse)\b/.test(t)) return true;
    if (/\bnao\s+me\s+(?:chame|chama|mande|manda|envie|envia|procure|procura|escreva|escreve|ligue|liga|incomode|incomoda|perturbe|perturba|contate)\b/.test(t)) return true;
    if (/\bnao\s+(?:precisa|precisam)\s+(?:mais\s+)?(?:me\s+)?(?:chamar|mandar|enviar|escrever|ligar)\b/.test(t)) return true;
    if (/\bsa(?:i|ir|ia)\s+da\s+lista\b|\btir(?:a|e|ar)\s+(?:o\s+)?meu\s+(?:numero|contato|telefone)\b|\bremov\w+\s+(?:o\s+)?meu\s+(?:numero|contato|telefone)\b/.test(t)) return true;
    if (/\bnunca\s+mais\b|\bsem\s+interesse\b|\bbloque\w+|\bdenunci\w+/.test(t)) return true;
  }
  return false;
}

const MESES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const NUM_PALAVRA = String.raw`(?:\d+|uns|umas|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta)`;
const RE_DATA_DITA = new RegExp(
  String.raw`\b\d{1,2}\s*/\s*\d{1,2}\b|\bdia\s+\d{1,2}\b|\b(?:${MESES})\b|\b(?:amanha|depois de amanha)\b|`
  + String.raw`\b(?:semana que vem|proxima semana|proximo mes|mes que vem|ano que vem|proximo ano)\b|`
  + String.raw`\b(?:segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b|`
  + String.raw`\b(?:daqui a|em)\s+${NUM_PALAVRA}\s+(?:dias?|semanas?|meses|mes)\b|`
  + String.raw`\b(?:fim|final|comeco|inicio|meio)\s+d[oae]\s+(?:mes|ano|semana)\b|`
  + String.raw`\b(?:depois|apos)\s+d?[oa]s?\s+(?:carnaval|natal|ano novo|pascoa|feriado|ferias)\b`,
);

/** O PRÓPRIO lead disse uma data ou um prazo ("dia 10", "mês que vem", "em novembro", "daqui a duas semanas")? */
export function leadDisseData(textos: readonly string[]): boolean {
  return textos.some(x => RE_DATA_DITA.test(semAcento(x)));
}

/** 9h de Brasília (meio-dia UTC) do dia dado, ISO. */
function noveDaManha(ano: number, mes: number, dia: number): string {
  return new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0)).toISOString();
}

export interface PlanoEstacionar {
  /** ISO, 9h de Brasília. */
  ate: string;
  comData: boolean;
  /** Sem data dita: prazo fixo de 30 dias e a retomada do dia é a última. */
  ultima: boolean;
  motivo: 'data_dita' | 'agora_nao';
}

/**
 * A data que o modelo pôs em dados.volta_em (DD/MM, DD/MM/AAAA ou AAAA-MM-DD), como [ano, mes, dia], ou null (torta).
 * DD/MM sem ano que já passou neste ano é do ANO SEGUINTE ("me chama em janeiro" dito em outubro). A data de hoje fica em
 * hoje (quem chama a trata como "já é hoje"). Ano escrito (2 ou 4 dígitos, ou ISO) vale como veio.
 */
function lerVoltaEm(bruto: string | undefined, hoje: [number, number, number]): [number, number, number] | null {
  const t = String(bruto ?? '').trim();
  let a: number; let m: number; let d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (r) { a = Number(r[1]); m = Number(r[2]); d = Number(r[3]); } else {
    r = /^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?$/.exec(t);
    if (!r) return null;
    d = Number(r[1]); m = Number(r[2]);
    if (r[3]) a = r[3].length === 2 ? 2000 + Number(r[3]) : Number(r[3]);
    else {
      a = hoje[0];
      // O mês/dia que já passou neste ano (antes de hoje) é do ano que vem.
      if (m < hoje[1] || (m === hoje[1] && d < hoje[2])) a += 1;
    }
  }
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return [a, m, d];
}

/** O dia (Brasília) em que a Base pode falar: segunda a sábado e fora de feriado nacional. Domingo e feriado andam para o próximo. */
function proximoDiaUtil(ano: number, mes: number, dia: number): [number, number, number] {
  let t = Date.UTC(ano, mes - 1, dia);
  for (let i = 0; i < 10; i++) {
    const dt = new Date(t);
    const ymd = `${dt.getUTCFullYear()}-${P2(dt.getUTCMonth() + 1)}-${P2(dt.getUTCDate())}`;
    if (dt.getUTCDay() !== 0 && !ehFeriadoBR(ymd)) break;
    t += DIA_MS;
  }
  const f = new Date(t);
  return [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
}

const noveDoDia = (v: readonly [number, number, number]): string => noveDaManha(v[0], v[1], v[2]);

/**
 * Até quando a pessoa fica estacionada. Com data dita pelo lead (o texto dele tem data ou prazo E o modelo pôs uma data
 * válida, de amanhã em diante): essa data, às 9h de Brasília, limitada a 180 dias (data mais longe fica nos 180 dias, nunca
 * no prazo fixo). Domingo e feriado nacional andam para o próximo dia útil. Qualquer outra coisa (sem data, data torta ou
 * vazia, hoje ou no passado, ou o modelo inventou uma que o lead não disse) cai no prazo fixo de 30 dias, que é a última
 * retomada.
 */
export function planejarEstacionar(a: { dados: Readonly<Record<string, string>>; textos: readonly string[]; agora: Date }): PlanoEstacionar {
  const hoje = diaBRT(a.agora);
  const [ah, mh, dh] = hoje.split('-').map(Number) as [number, number, number];
  const util = proximoDiaUtil(ah, mh, dh + LIMITES_BASE.estacionadoFixoDias);
  const plano: PlanoEstacionar = { ate: noveDoDia(util), comData: false, ultima: true, motivo: 'agora_nao' };
  const v = lerVoltaEm(a.dados.volta_em, [ah, mh, dh]);
  if (!v || !leadDisseData(a.textos)) return plano;
  const dia = `${v[0]}-${P2(v[1])}-${P2(v[2])}`;
  const dias = Math.round((Date.UTC(v[0], v[1] - 1, v[2]) - Date.UTC(ah, mh - 1, dh)) / DIA_MS);
  if (dia <= hoje || dias < 1) return plano;
  const alvo = dias > LIMITES_BASE.estacionadoMaxDias
    ? proximoDiaUtil(ah, mh, dh + LIMITES_BASE.estacionadoMaxDias)
    : proximoDiaUtil(v[0], v[1], v[2]);
  return { ate: noveDoDia(alvo), comData: true, ultima: false, motivo: 'data_dita' };
}

/** O patch de `base` quando a ação estacionar vale. Sem texto do lead: só o código do motivo. */
export function patchDoEstacionar(plano: PlanoEstacionar, agora: Date): Record<string, unknown> {
  return {
    estacionado_ate: plano.ate,
    estacionado_motivo: plano.motivo,
    ultima: plano.ultima,
    estacionado_em: agora.toISOString(),
    tentativa: null,
  };
}
