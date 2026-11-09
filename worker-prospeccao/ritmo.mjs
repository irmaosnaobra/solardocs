/* ─────────────────────────────────────────────────────────────────────────────
   RITMO — as regras anti-ban do worker, em funções puras (sem rede, sem Chrome).

   Moram aqui, e não dentro do worker.mjs, por um motivo: o worker.mjs chama
   main() no import, então não dá para testar nada dele sem ligar o robô. Estas
   funções são testadas por teste-ritmo.mjs, que nunca toca em Instagram,
   WhatsApp nem banco.

   REGRA DE OURO: a env só APERTA. Nada aqui abre a janela além de 8h-21h, nem
   baixa o piso de 45 min entre envios, nem sobe o teto do Instagram de 5.
   ───────────────────────────────────────────────────────────────────────────── */
import { createHash } from 'node:crypto';

export const FUSO = 'America/Sao_Paulo';
export const JANELA_INI = 8;          // primeira hora cheia em que pode ENVIAR
export const JANELA_FIM = 21;         // às 21h00 já não envia
export const PISO_SEG = 2700;         // 45 min entre dois envios da mesma conta
export const TETO_INSTAGRAM = 10;     // limite DURO do Instagram (por rampa: 5 a 10). A env só pode DESCER.
export const RAMPA_INICIAL = 5;       // onde a rampa começa, volta depois de bloqueio, e quanto vale teto_manual nulo
export const TETO_CHIP = 10;          // WhatsApp do chip
export const DIAS_ENTRE_CANAIS = 14;  // o 2º canal só entra 14 dias depois do 1º toque
export const MAX_TOQUES_60D = 3;      // somando os canais
export const ESPERA_MAX_SEG = 4500;   // espera sorteada entre envios: de 45 min (piso) a 75 min
export const ALMOCO_INI_MIN = 12 * 60;        // pausa de almoço SEM ENVIO: 12h00 ...
export const ALMOCO_FIM_MIN = 13 * 60 + 30;   // ... até 13h30 (BRT)
export const PRIMEIRO_INI_MIN = 8 * 60 + 10;  // o 1º envio do dia cai entre 8h10 ...
export const PRIMEIRO_FIM_MIN = 9 * 60 + 30;  // ... e 9h30 (BRT)

/** Número da env; vazio, NaN ou infinito caem no padrão (nunca em 0). */
const num = (v, padrao) => {
  if (v === undefined || v === null || String(v).trim() === '') return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};

/**
 * Config de ritmo a partir de um objeto de env. A env só aperta:
 *   HORA_INI nunca abaixo de 8 · HORA_FIM nunca acima de 21 · MIN_SEG nunca
 *   abaixo de 2700. Se depois de apertar a janela inverte (ini >= fim), ela
 *   FECHA (horaIni = horaFim): falha segura, não abre 24h.
 */
export function cfgDe(env = {}) {
  const horaIni = Math.min(24, Math.max(JANELA_INI, Math.round(num(env.HORA_INI, JANELA_INI))));
  const horaFim = Math.max(0, Math.min(JANELA_FIM, Math.round(num(env.HORA_FIM, JANELA_FIM))));
  const minSeg = Math.max(PISO_SEG, num(env.MIN_SEG, PISO_SEG));
  const maxSeg = Math.max(minSeg, num(env.MAX_SEG, ESPERA_MAX_SEG));
  const tetoEspera = Math.max(minSeg, num(env.TETO_ESPERA, ESPERA_MAX_SEG));
  // Teto do Instagram: a env só DESCE (1 a 10), nunca passa de 10.
  const tetoInstagramMax = Math.max(1, Math.min(TETO_INSTAGRAM, Math.round(num(env.TETO_INSTAGRAM_MAX, TETO_INSTAGRAM))));
  // Janela invertida ou vazia: fecha (ini = fim), nunca abre.
  return { horaIni: Math.min(horaIni, horaFim), horaFim, minSeg, maxSeg, tetoEspera, tetoInstagramMax };
}

/** Hora cheia (0-23), minuto (0-59), dia da semana (0 = domingo) e data (AAAA-MM-DD) em Brasília. */
export function relogioBRT(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO, hourCycle: 'h23', weekday: 'short', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { hora: Number(p.hour) % 24, min: Number(p.minute) % 60, dow, dia: `${p.year}-${p.month}-${p.day}` };
}

/** Está na pausa de almoço (12h00 a 13h29 BRT)? Não envia. Fica FORA do podeEnviar de propósito: o responder do WhatsApp também usa o podeEnviar. */
export function emAlmoco(d = new Date()) {
  const { hora, min } = relogioBRT(d);
  const m = hora * 60 + min;
  return m >= ALMOCO_INI_MIN && m < ALMOCO_FIM_MIN;
}

/** Pode ENVIAR agora? Segunda a sábado, de horaIni (inclusive) a horaFim (exclusive). */
export function podeEnviar(d = new Date(), cfg = cfgDe({})) {
  const { hora, dow } = relogioBRT(d);
  if (dow === 0) return false;
  return hora >= cfg.horaIni && hora < cfg.horaFim;
}

/** Segundos de TEMPO ÚTIL entre `agora` e `fim`: o almoço (12h00-13h30 do dia de `agora`) não conta. */
export function segUteisAte(agora, fim) {
  const { dia } = relogioBRT(agora);
  const aIni = new Date(`${dia}T${String(Math.floor(ALMOCO_INI_MIN / 60)).padStart(2, '0')}:${String(ALMOCO_INI_MIN % 60).padStart(2, '0')}:00-03:00`);
  const aFim = new Date(`${dia}T${String(Math.floor(ALMOCO_FIM_MIN / 60)).padStart(2, '0')}:${String(ALMOCO_FIM_MIN % 60).padStart(2, '0')}:00-03:00`);
  const comeco = Math.max(agora.getTime(), aIni.getTime());
  const termino = Math.min(fim.getTime(), aFim.getTime());
  const almoco = Math.max(0, termino - comeco);
  return Math.floor((fim.getTime() - agora.getTime() - almoco) / 1000);
}

/**
 * Espera até o próximo envio, em segundos. O Math.max(minSeg) é a operação MAIS
 * EXTERNA: nenhum teto de espera, nenhuma conta de "sobra pouco" fura o piso.
 *
 * A espera é SORTEADA (uniforme) entre o piso (45 min) e um teto que é o menor entre o
 * máximo (75 min) e o "ideal" (tempo útil que sobra do dia, sem o almoço, dividido pelo que
 * falta do teto). Dia folgado: de 45 a 75 min. Dia apertado: o sorteio encolhe para perto
 * dos 45 min. `sorteio` (0 a 1) entra de fora para o teste ser determinístico; sem ele,
 * deriva do `jitter` antigo (0.75 a 1.25).
 */
export function calcularEspera({ agora = new Date(), cfg, restam, jitter = 1, sorteio }) {
  const { dia } = relogioBRT(agora);
  const fim = new Date(`${dia}T${String(cfg.horaFim).padStart(2, '0')}:00:00-03:00`);
  const sobramSeg = Math.max(60, segUteisAte(agora, fim));
  const ideal = Math.floor(sobramSeg / Math.max(1, restam));
  const teto = Math.max(cfg.minSeg, Math.min(cfg.tetoEspera, ideal));
  const f0 = Number.isFinite(sorteio) ? sorteio : (jitter - 0.75) / 0.5;
  const frac = Math.min(1, Math.max(0, Number.isFinite(f0) ? f0 : 0));
  const bruto = cfg.minSeg + Math.floor(frac * (teto - cfg.minSeg));
  return Math.max(cfg.minSeg, bruto);
}

/** Minutos (0-59) de um instante, em Brasília. */
const minutoBRT = ms => relogioBRT(new Date(ms)).min;

/**
 * Instante-alvo do próximo envio, ajustado para parecer gente: se cair no almoço, vai para as 13h30;
 * se o minuto terminar em 0 ou 5, empurra de 1 a 4 min PARA FRENTE (nunca para trás, então o piso
 * de 45 min só aumenta). `frac` (0 a 1) vem de fora.
 */
export function ajustarInstante(ms, frac = 0.5) {
  let t = ms;
  const f = Math.min(0.999999, Math.max(0, Number.isFinite(frac) ? frac : 0));
  if (emAlmoco(new Date(t))) {
    const r = relogioBRT(new Date(t));
    const m = r.hora * 60 + r.min;
    t += ((ALMOCO_FIM_MIN - m) * 60 - (Math.floor(t / 1000) % 60)) * 1000;   // 13h30m00s
  }
  if (minutoBRT(t) % 5 === 0) t += (1 + Math.floor(f * 4)) * 60_000;
  return t;
}

/** Quanto esperar (ms) ANTES de apertar o Enter para o minuto não terminar em 0 ou 5. 0 = pode agora. */
export function esperaParaMinutoBom(agoraMs, frac = 0.5) {
  if (minutoBRT(agoraMs) % 5 !== 0) return 0;
  const f = Math.min(0.999999, Math.max(0, Number.isFinite(frac) ? frac : 0));
  return (1 + Math.floor(f * 4)) * 60_000;
}

/**
 * Início do dia: instante (ms) do 1º envio, entre 8h10 e 9h30 BRT. Determinístico por dia e conta
 * (hash), então um reinício no meio da manhã não sorteia outro horário. Minuto nunca terminado em 0 ou 5.
 */
export function inicioDoDia(dia, sal = '') {
  const h = createHash('sha256').update(`${dia}|${sal}`).digest();
  const cand = [];
  for (let m = PRIMEIRO_INI_MIN + 1; m < PRIMEIRO_FIM_MIN; m++) if (m % 5) cand.push(m);
  const m = cand[h.readUInt32BE(0) % cand.length];
  return new Date(`${dia}T00:00:00-03:00`).getTime() + (m * 60 + (h[4] % 60)) * 1000;
}

/**
 * Teto e sobra EFETIVOS. O `restam` da view foi calculado com o teto do banco
 * (12 no Instagram), então limitar só o `teto` não basta: recalcula `restam`.
 */
/** teto_manual da rampa para o Instagram: nulo vale 5 (nulo cairia na rampa da VIEW, de 25 a 100); número ilegível vale 0. */
export function tetoManualInstagram(v) {
  if (v === null) return RAMPA_INICIAL;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function tetoEfetivo(canal, { teto, usados, restam, tetoManual }, bloqueado = false, maxIg = TETO_INSTAGRAM) {
  // Sem linha em prospeccao_teto_hoje (teto indefinido) = teto 0: a falha é segura, nunca "consultor novo = 5".
  // Bloqueio de conversa nova ativo = teto de frio 0 (responder quem já conversa segue normal).
  if (bloqueado) return { teto: 0, restam: 0 };
  const limite = canal === 'instagram' ? Math.min(TETO_INSTAGRAM, Number.isFinite(maxIg) ? maxIg : TETO_INSTAGRAM) : TETO_CHIP;
  // Instagram: a alavanca é o teto_manual da rampa (5 a 10). A rampa da VIEW (25 a 100) NUNCA vale para ele.
  const base = canal === 'instagram' && tetoManual !== undefined ? tetoManualInstagram(tetoManual) : teto;
  const t = Math.min(Number.isFinite(base) ? base : 0, limite);
  const u = Number.isFinite(usados) ? usados : 0;
  const r = Number.isFinite(restam) ? restam : 0;
  return { teto: t, restam: Math.max(0, Math.min(r, t - u)) };
}

/** Quantos ms faltam para o piso do último envio vencer (0 = já pode). */
export function faltaParaPiso(ultimoEnvioMs, agoraMs, cfg) {
  if (!Number.isFinite(ultimoEnvioMs)) return cfg.minSeg * 1000;   // não sei quando foi: espero o piso inteiro
  const passou = Math.max(0, agoraMs - ultimoEnvioMs);             // data no futuro não vale
  return Math.max(0, cfg.minSeg * 1000 - passou);
}

// ── FILA ÚNICA ENTRE OS DOIS CANAIS ──────────────────────────────────────────
/** De que canal foi um toque. 'desconhecido' é tratado como o pior caso. */
export function canalDoToque(t) {
  const obs = String(t.obs || '').toLowerCase();
  if (/worker\s+whatsapp/.test(obs)) return 'whatsapp';
  if (/worker\s+instagram/.test(obs)) return 'instagram';
  if (t.consultor === 'whatsapp_prospeccao') return 'whatsapp';
  if (t.consultor === 'irmaosnaobra__') return 'instagram';
  return 'desconhecido';
}

/**
 * Pode abordar esta EMPRESA (contato_id) por `canal`, dado o histórico de toques?
 *  - qualquer resultado diferente de 'enviei' (respondeu, sem_interesse,
 *    nao_perturbar...) = a empresa deu retorno: não abordo;
 *  - 3 toques em 60 dias, somando os canais: não abordo;
 *  - já recebeu POR ESTE canal: não mando a segunda fria;
 *  - o 1º toque foi do OUTRO canal: só entra 14 dias depois do último toque;
 *  - toque de canal desconhecido: não abordo (falha segura).
 */
export function avaliarToques(toques, canal, agoraMs = Date.now()) {
  if (!Array.isArray(toques)) return { ok: false, motivo: 'histórico de toques ilegível' };
  if (toques.some(t => t.resultado !== 'enviei')) return { ok: false, motivo: 'a empresa já deu retorno ou pediu para parar' };
  const env = toques.filter(t => t.resultado === 'enviei');
  if (!env.length) return { ok: true };
  const recentes = env.filter(t => agoraMs - Date.parse(t.criado_em) <= 60 * 86400_000);
  if (recentes.length >= MAX_TOQUES_60D) return { ok: false, motivo: `já teve ${recentes.length} toques em 60 dias` };
  const canais = env.map(canalDoToque);
  if (canais.includes('desconhecido')) return { ok: false, motivo: 'toque anterior de canal desconhecido' };
  if (canais.includes(canal)) return { ok: false, motivo: `já recebeu a fria por ${canal}; segunda fria no mesmo canal não` };
  const ultimo = Math.max(...env.map(t => Date.parse(t.criado_em)));
  if (!Number.isFinite(ultimo)) return { ok: false, motivo: 'data do toque anterior ilegível' };
  const dias = (agoraMs - ultimo) / 86400_000;
  if (dias < DIAS_ENTRE_CANAIS) {
    return { ok: false, motivo: `o outro canal falou há ${Math.floor(dias)} dia(s); espero ${DIAS_ENTRE_CANAIS}` };
  }
  return { ok: true, segundoCanal: true };
}

// ── LINHAS QUE NUNCA PROSPECTAM ──────────────────────────────────────────────
// Mesmos hashes (sha256 do número sem o 55) do ligar-whatsapp.mjs: a linha IO
// (5040) e o celular do dono. O ligar recusa na hora de ligar; o worker confere
// de novo a cada vez que lê a sessão, porque o chip pode ser trocado no Chrome.
const PROIBIDOS = new Set([
  '3c29bb19ab77fc2db6010f0633e373da538038352ec330dcc65a38b0cecd03bb',
  'c5553c7963affdec11f8e9d9fbc2059dfb554d84817068d1358914d788a7dd8e',
]);
const sha = s => createHash('sha256').update(s).digest('hex');

/** true = NÃO pode prospectar por esta conta. Número ausente = não dá para provar, então bloqueia. */
export function contaProibida(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length < 10) return true;
  const semPais = d.replace(/^55/, '');
  const candidatos = new Set([semPais, semPais.slice(-11), semPais.slice(-10)]);
  // Conta antiga aparece sem o 9 na frente: testa também com o 9 reposto.
  if (semPais.length === 10) candidatos.add(semPais.slice(0, 2) + '9' + semPais.slice(2));
  return [...candidatos].some(c => PROIBIDOS.has(sha(c)));
}

// ── PISO ENTRE ENVIOS: DECISÃO PURA (chamada pelo worker.mjs) ────────────────
// O piso de 45 min NÃO pode depender de memória do processo: o COMECAR.ps1
// religa o node 60 s depois de qualquer queda (inclusive o process.exit(1) do
// Chrome mudo). Por isso o "último envio ou tentativa" vem de DUAS fontes, e vale
// a MAIOR: o banco (prospeccao_toques) e um arquivo local ultimo-envio-<canal>.json.
// Cada fonte é { ok, ms }: ok=false é "não consegui ler" (banco fora, arquivo
// corrompido); ms=null com ok=true é "li e nunca houve envio".

/** Texto do arquivo local -> { ok, ms }. null = arquivo não existe (nunca enviou por aqui). */
export function arquivoUltimo(texto) {
  if (texto === null || texto === undefined) return { ok: true, ms: null, pendente: null };
  try {
    const j = JSON.parse(texto);
    const p = j && j.pendente_gravar && j.pendente_gravar.id ? j.pendente_gravar : null;
    const pendente = p ? { id: p.id, pid: p.pid ?? null, ms: Number(p.ms), obs: typeof p.obs === 'string' ? p.obs : null } : null;
    const ms = Number.isFinite(Number(j.ms)) ? Number(j.ms) : (pendente && Number.isFinite(pendente.ms) ? pendente.ms : NaN);
    return Number.isFinite(ms) ? { ok: true, ms, pendente } : { ok: false, ms: null, pendente };
  } catch { return { ok: false, ms: null, pendente: null }; }
}

/** Ms que faltam para o piso vencer. Sem nenhuma hora conhecida e alguma fonte ilegível: espera o piso INTEIRO. */
export function faltaPiso({ agoraMs, cfg, banco, arquivo, pendente }) {
  const fontes = [banco, arquivo].filter(Boolean);
  const horas = fontes.filter(f => f.ok && Number.isFinite(f.ms)).map(f => f.ms);
  if (pendente && Number.isFinite(pendente.ms)) horas.push(pendente.ms);   // o envio pendente de gravar é o último envio
  if (horas.length) return faltaParaPiso(Math.max(...horas), agoraMs, cfg);
  const tudoLido = fontes.length === 2 && fontes.every(f => f.ok);
  return tudoLido ? 0 : cfg.minSeg * 1000;   // nunca enviou (lido nas duas) ou não sei: o piso inteiro
}

/**
 * Pode ENVIAR agora? Ordem: bloqueio, pendência, janela, almoço, piso, início do dia, teto.
 * `restam` indefinido = não confere o teto. `sorteioDia` (texto: ex. o consultor) liga a regra do
 * 1º envio do dia (entre 8h10 e 9h30, ver inicioDoDia); indefinido = regra desligada (testes antigos).
 * Devolve { enviar, motivo: 'bloqueio'|'pendente'|'janela'|'almoco'|'piso'|'inicio'|'teto'|null, esperaMs }.
 */
export function decidirAbordagem({ agora = new Date(), cfg, restam, banco, arquivo, pendente, bloqueio, sorteioDia }) {
  // Bloqueio de conversa nova (arquivo bloqueio-<canal>.json ou detector em memória): frio 0.
  if (bloqueio && bloqueio.bloqueado) return { enviar: false, motivo: 'bloqueio', esperaMs: 3600_000 };
  // ENVIO PENDENTE DE GRAVAR (a DM saiu, mas o toque não entrou no banco): ninguém mais é abordado
  // até um toque gravar com sucesso. Vem da memória ou do arquivo local (sobrevive a reinício).
  const pend = pendente || (arquivo && arquivo.pendente) || null;
  if (pend) return { enviar: false, motivo: 'pendente', esperaMs: 120_000 };
  if (!podeEnviar(agora, cfg)) return { enviar: false, motivo: 'janela', esperaMs: 600_000 };
  if (emAlmoco(agora)) {
    const r = relogioBRT(agora);
    return { enviar: false, motivo: 'almoco', esperaMs: Math.max(60_000, ((ALMOCO_FIM_MIN - (r.hora * 60 + r.min)) * 60) * 1000) };
  }
  const falta = faltaPiso({ agoraMs: agora.getTime(), cfg, banco, arquivo, pendente: pend });
  if (falta > 0) return { enviar: false, motivo: 'piso', esperaMs: falta };
  if (sorteioDia !== undefined) {
    // 1º envio do dia: só depois do horário sorteado (8h10-9h30). "Já enviou hoje" = a maior hora
    // conhecida (banco, arquivo, pendência) cai no dia de hoje em Brasília.
    const horas = [banco, arquivo].filter(f => f && f.ok && Number.isFinite(f.ms)).map(f => f.ms);
    if (pend && Number.isFinite(pend.ms)) horas.push(pend.ms);
    const hoje = relogioBRT(agora).dia;
    const jaHoje = horas.length > 0 && relogioBRT(new Date(Math.max(...horas))).dia === hoje;
    if (!jaHoje) {
      const ini = inicioDoDia(hoje, sorteioDia);
      if (agora.getTime() < ini) return { enviar: false, motivo: 'inicio', esperaMs: Math.max(60_000, ini - agora.getTime()) };
    }
  }
  if (restam !== undefined && !(restam > 0)) return { enviar: false, motivo: 'teto', esperaMs: 600_000 };
  return { enviar: true, motivo: null, esperaMs: 0 };
}

/** Canal exigido na linha de comando: sem padrão, para ninguém prospectar pela conta errada por esquecimento. */
export const canalValido = c => c === 'instagram' || c === 'whatsapp';

/** O teto do dia conta o envio pendente de gravar como envio (o banco ainda não o enxerga). */
export const restamComPendente = (restam, pendente) => Math.max(0, (Number(restam) || 0) - (pendente ? 1 : 0));

/**
 * Tenta gravar até `vezes` vezes (padrão 3). Devolve true se gravou. O chamador, se receber false,
 * registra o envio como PENDENTE e para de abordar até gravar (ver decidirAbordagem).
 * `gravar` e `dorme` entram de fora: o teste usa funções falsas.
 */
export async function gravarComRetentativa(gravar, { vezes = 3, esperaMs = 1500, dorme = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let i = 1; i <= vezes; i++) {
    try { await gravar(i); return true; }
    catch { if (i < vezes) await dorme(esperaMs * i); }
  }
  return false;
}

// ── RESPIRO APÓS FALHA (regra 25) ────────────────────────────────────────────
// Falhar ainda significa ter ABERTO um perfil, e perfil atrás de perfil é assinatura de raspador.
export const RESPIRO_MIN_SEG = 300;
export const RESPIRO_MAX_SEG = 600;
/** Segundos de espera depois de um perfil que não abriu: de 300 a 599. frac vem de fora (0 a 1) para o teste ser exato. */
export function respiroAposFalha(frac) {
  const f = Number.isFinite(frac) ? Math.min(0.999999, Math.max(0, frac)) : 0;
  return RESPIRO_MIN_SEG + Math.floor((RESPIRO_MAX_SEG - RESPIRO_MIN_SEG) * f);
}

// ── BLOQUEIO DE CONVERSA NOVA, NO DISCO ──────────────────────────────────────
// Arquivo bloqueio-<canal>.json: { "desde": ISO-8601, "motivo": texto, "perfis": [@...] }.
// A SIMPLES EXISTÊNCIA do arquivo bloqueia o frio (conteúdo ilegível também). Só sai à mão, ou pelo
// testar-bloqueio.mjs quando o compositor abre de novo em perfil novo.
/** Texto do arquivo (null = não existe) -> { bloqueado, desde, motivo, perfis, corrompido }. */
export function parseBloqueio(texto) {
  if (texto === null || texto === undefined) return { bloqueado: false };
  try {
    const j = JSON.parse(texto);
    return { bloqueado: true, desde: j.desde || null, motivo: j.motivo || null, perfis: Array.isArray(j.perfis) ? j.perfis : [], rebaixado: j.rebaixado === true, corrompido: false };
  } catch { return { bloqueado: true, desde: null, motivo: 'arquivo de bloqueio ilegível', perfis: [], rebaixado: false, corrompido: true }; }
}

// ── RESPOSTA AUTOMÁTICA JÁ TRATADA (responder) ───────────────────────────────
// Quando a API devolve nao_enviar (resposta automática de perfil), o worker não envia nem grava toque. Para
// não pagar o modelo de novo a cada volta com a MESMA última mensagem, a marca (contato + hash do texto) fica
// num arquivo local por canal ({ chave: ms }), podada após 7 dias. Mensagem nova do lead = outra chave = libera.
export const TRATADAS_DIAS = 7;
/** Chave da última mensagem do lead num contato. */
export const chaveTratada = (contatoId, texto) =>
  `${contatoId}|${createHash('sha256').update(String(texto ?? '').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)}`;
/** Texto do arquivo (null = não existe, ilegível = vazio) -> mapa { chave: ms }, já sem o que passou de 7 dias. */
export function lerTratadas(texto, agoraMs = Date.now()) {
  let j = {};
  try { j = texto ? JSON.parse(texto) : {}; } catch { j = {}; }
  const mapa = {};
  for (const [k, ms] of Object.entries(j && typeof j === 'object' ? j : {})) {
    if (Number.isFinite(ms) && agoraMs - ms <= TRATADAS_DIAS * 86400_000) mapa[k] = ms;
  }
  return mapa;
}
/** Esta última mensagem do lead já recebeu nao_enviar? */
export const jaTratada = (mapa, contatoId, texto) => Object.prototype.hasOwnProperty.call(mapa || {}, chaveTratada(contatoId, texto));
/** Devolve o mapa com a mensagem marcada (e podado). */
export const marcarTratada = (mapa, contatoId, texto, agoraMs = Date.now()) =>
  ({ ...lerTratadas(JSON.stringify(mapa || {}), agoraMs), [chaveTratada(contatoId, texto)]: agoraMs });

// ── FREIO POR PERFIS DISTINTOS (Instagram) ───────────────────────────────────
// O freio liga com 3 PERFIS DISTINTOS em que a conversa nova não funcionou: a caixa de DM não abriu
// OU o texto "ficou na caixa / não saiu". Os dois sintomas contam no MESMO contador. Um envio
// confirmado só zera o contador se a conversa era NOVA (conversaAntiga === false): numa conversa
// que já existia o compositor abre mesmo com a restrição (13/09), então não prova nada.
export const LIMITE_PERFIS_FREIO = 3;
const MOTIVO_FREIO = /caixa de DM não abriu|ficou na caixa|não saiu/i;
/** Este motivo de falha conta para o freio? */
export const contaParaFreio = motivo => MOTIVO_FREIO.test(String(motivo || ''));
/** Registra a falha no Set de perfis (MUTA o Set). Devolve { conta, perfis, liga }. */
export function registrarFalhaCaixa(perfis, perfil, motivo, { prova = false } = {}) {
  const conta = contaParaFreio(motivo);
  if (conta && perfil) perfis.add(String(perfil));
  // Nos envios de PROVA (os 3 primeiros depois de uma volta automática) UMA falha já liga o freio, sem esperar 3 perfis.
  return { conta, perfis: perfis.size, liga: perfis.size >= LIMITE_PERFIS_FREIO || (prova === true && conta) };
}
/** Depois de um envio confirmado. Só conversa NOVA (false) limpa o Set (MUTA). Devolve true se limpou. */
export function aposEnvioConfirmado(perfis, { conversaAntiga } = {}) {
  if (conversaAntiga !== false) return false;   // antiga ou não medida: não prova que a restrição passou
  perfis.clear();
  return true;
}
/** O toque é um envio INCERTO (a marca "incerto" no obs)? */
export const ehIncerto = obs => /\bincerto\b/i.test(String(obs || ''));
/** Quantos toques 'enviei' são CONFIRMADOS (sem a marca incerto): é o que a rampa e o "dia limpo" contam. */
export const enviosConfirmados = toques => (Array.isArray(toques) ? toques : [])
  .filter(t => t && t.resultado === 'enviei' && !ehIncerto(t.obs)).length;

// ── DIGITAÇÃO E ROLAGEM HUMANAS (só no envio frio do Instagram) ──────────────
export const TECLA_MIN_MS = 60, TECLA_MAX_MS = 220;          // atraso por caractere
export const PAUSA_CADA_MIN = 15, PAUSA_CADA_MAX = 40;       // a cada 15-40 caracteres ...
export const PAUSA_MIN_MS = 1000, PAUSA_MAX_MS = 3000;       // ... uma pausa de 1 a 3 s
export const ROLAR_MIN_MS = 4000, ROLAR_MAX_MS = 12000;      // rolar o perfil antes de escrever
const entre = (min, max, rnd) => min + Math.floor(Math.min(0.999999, Math.max(0, rnd())) * (max - min + 1));
/** Atrasos de digitação: um item por caractere, { atraso, pausa } (pausa 0 = sem pausa longa). `rnd` devolve 0 a 1. */
export function planoDigitacao(n, rnd = Math.random) {
  const plano = [];
  let ate = entre(PAUSA_CADA_MIN, PAUSA_CADA_MAX, rnd);
  for (let i = 0; i < n; i++) {
    let pausa = 0;
    if (--ate <= 0) { pausa = entre(PAUSA_MIN_MS, PAUSA_MAX_MS, rnd); ate = entre(PAUSA_CADA_MIN, PAUSA_CADA_MAX, rnd); }
    plano.push({ atraso: entre(TECLA_MIN_MS, TECLA_MAX_MS, rnd), pausa });
  }
  return plano;
}
/** Duração da rolagem do perfil, de 4000 a 12000 ms. */
export const duracaoRolagemMs = (rnd = Math.random) => entre(ROLAR_MIN_MS, ROLAR_MAX_MS, rnd);
/** Passos de rolagem [{ dy, pausaMs }] cujas pausas SOMAM exatamente `totalMs`. */
export function passosRolagem(totalMs, rnd = Math.random) {
  const passos = [];
  let resta = totalMs;
  while (resta > 0) {
    const pausaMs = Math.min(resta, entre(600, 1800, rnd));
    const dy = (rnd() < 0.8 ? 1 : -1) * entre(120, 520, rnd);
    passos.push({ dy, pausaMs });
    resta -= pausaMs;
  }
  return passos;
}

// ── RAMPA DO INSTAGRAM (de 7e99c97b, como função pura) ───────────────────────
// Começa em 5/dia; +1 só depois de um dia CHEIO (ontem saiu o teto inteiro); nunca passa de 10; bloqueio
// volta a 5. Roda 1 vez por dia: a marca vem de rampa-<canal>.json (e de atualizado_em no banco), então um
// reinício no mesmo dia não soma duas vezes. Domingo não conta (o robô não envia): na segunda, "ontem" é o
// sábado. teto_manual = 0 é o congelamento feito à mão e NUNCA é levantado por aqui.
const diaUTC = dia => new Date(dia + 'T12:00:00Z');
export const ehDomingo = dia => diaUTC(dia).getUTCDay() === 0;
/** Dia útil (não domingo) anterior a `dia`, no formato AAAA-MM-DD. */
export function diaAnteriorUtil(dia) {
  let d = diaUTC(dia);
  do { d = new Date(d.getTime() - 86400_000); } while (d.getUTCDay() === 0);
  return d.toISOString().slice(0, 10);
}
/** Limites [ini, fim) do dia em Brasília, em ISO UTC (para consultar toques). */
export function limitesDoDia(dia) {
  const ini = new Date(`${dia}T00:00:00-03:00`);
  return { ini: ini.toISOString(), fim: new Date(ini.getTime() + 86400_000).toISOString() };
}
/**
 * Decide o teto_manual de hoje. Devolve { gravar, novo, marcar, motivo }:
 *   gravar = escrever `novo` em prospeccao_rampa.teto_manual; marcar = registrar que hoje já foi olhado.
 * hoje/marcaDia/atualizadoDia: AAAA-MM-DD em Brasília. atualManual: o teto_manual lido (null = nulo).
 * enviadosDiaAnterior: toques 'enviei' do último dia útil. bloqueado: canal bloqueado agora (ou ontem).
 */
export function decidirRampa({ hoje, marca, marcaDia, atualizadoDia, atualManual, enviadosDiaAnterior, bloqueado, ultimoBloqueioDia, maxIg = TETO_INSTAGRAM }) {
  const nada = motivo => ({ gravar: false, novo: null, marcar: false, motivo });
  const jaRodou = marca ? marca.dia : marcaDia;
  if (ehDomingo(hoje)) return nada('domingo não conta');
  if (jaRodou === hoje) return nada('a rampa já rodou hoje');
  if (atualizadoDia === hoje) return { gravar: false, novo: null, marcar: true, motivo: 'o teto já foi mexido hoje (bloqueio ou rampa)' };
  if (atualManual === 0) return { gravar: false, novo: null, marcar: true, motivo: 'teto_manual 0: congelado à mão, a rampa não levanta' };
  if (atualManual === null || atualManual === undefined) return { gravar: true, novo: RAMPA_INICIAL, marcar: true, motivo: 'teto_manual nulo cairia na rampa da view: volta a ' + RAMPA_INICIAL };
  const atual = Number(atualManual);
  if (!Number.isFinite(atual) || atual < 0) return nada('teto_manual ilegível');
  const teto = Math.min(atual, maxIg);                       // o limite duro vale mesmo que alguém ponha 12 à mão
  let novo = teto;
  let motivo = 'dia não cheio: mantém ' + teto;
  // "Cheio" = ontem saiu o teto DAQUELE dia (o gravado na marca de ontem), nunca o de hoje, já rebaixado.
  const anterior = diaAnteriorUtil(hoje);
  const tetoDeOntem = marca && marca.dia === anterior && Number(marca.teto) > 0 ? Number(marca.teto) : null;
  const diaDoBloqueio = Boolean((marca && marca.dia === anterior && marca.bloqueio) || (ultimoBloqueioDia && ultimoBloqueioDia >= anterior));
  if (bloqueado) motivo = 'canal bloqueado (ou rebaixe sem prova): não sobe';
  else if (diaDoBloqueio) motivo = 'o dia do bloqueio nunca conta como cheio: não sobe';
  else if (tetoDeOntem === null) motivo = 'sem a marca do teto de ontem: não subo sem prova';
  else if (Number(enviadosDiaAnterior) >= tetoDeOntem && teto > 0) {
    novo = Math.min(maxIg, atual + 1);
    motivo = novo > atual ? 'dia cheio (' + enviadosDiaAnterior + '/' + tetoDeOntem + '): sobe para ' + novo : 'já no limite de ' + maxIg;
  }
  return { gravar: novo !== atual, novo, marcar: true, motivo };
}

// ── HISTÓRICO DO ÚLTIMO BLOQUEIO (não se apaga no destrave) ──────────────────
// historico-bloqueio-<canal>.json: { ultimo: ISO, dia: AAAA-MM-DD (Brasília), rebaixado: bool, rebaixadoEm }.
// rebaixado=true é a PROVA de que o teto_manual foi a 5 depois do último bloqueio. Sem a prova, o teto
// do Instagram é no máximo 5, seja qual for o banco; assim apagar o bloqueio à mão não sobe o teto.
export function parseHistorico(texto) {
  if (texto === null || texto === undefined) return null;
  try {
    const j = JSON.parse(texto);
    const lista = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
    return {
      ultimo: j.ultimo || null, dia: j.dia || null, rebaixado: j.rebaixado === true, rebaixadoEm: j.rebaixadoEm || null, corrompido: false,
      freios: lista(j.freios), voltas: lista(j.voltas), parado: j.parado === true,
      testes: Array.isArray(j.testes) ? j.testes.filter(t => t && typeof t.arroba === 'string' && typeof t.em === 'string').map(t => ({ arroba: t.arroba, em: t.em, limpo: t.limpo === true })) : [],
      prova: j.prova && typeof j.prova === 'object' ? { ativa: j.prova.ativa === true, confirmados: Number(j.prova.confirmados) || 0, desde: j.prova.desde || null } : null,
    };
  } catch { return { ultimo: null, dia: null, rebaixado: false, rebaixadoEm: null, corrompido: true, freios: [], voltas: [], parado: false, testes: [], prova: null }; }
}
/** Dia (AAAA-MM-DD, Brasília) de um instante ISO. */
export const diaDeIso = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : relogioBRT(d).dia; };
/** Máximo do Instagram: 5 enquanto o rebaixe não foi provado depois do último bloqueio; senão o limite normal. */
export function maxInstagramEfetivo({ bloqueio, historico, maxIg = TETO_INSTAGRAM }) {
  const semProva = Boolean((bloqueio && bloqueio.bloqueado && bloqueio.rebaixado !== true) || (historico && historico.rebaixado !== true));
  return semProva ? Math.min(maxIg, RAMPA_INICIAL) : maxIg;
}
/** O histórico precisa ser criado/atualizado a partir do arquivo de bloqueio (inclusive um criado à mão)? */
export function historicoPrecisaSincronizar(bloqueio, historico) {
  if (!bloqueio || !bloqueio.bloqueado) return false;
  if (!historico) return true;
  if (bloqueio.desde && historico.ultimo && Date.parse(bloqueio.desde) > Date.parse(historico.ultimo)) return true;
  return false;
}

// ── VOLTA AUTOMÁTICA DO INSTAGRAM (09/11/2026, aprovada pelo chefe-antiban) ───
// Tudo vive em historico-bloqueio-<canal>.json (disco, nunca em memória): freios[] e voltas[] (ISO), testes[]
// ({ arroba, em, limpo }), prova ({ ativa, confirmados }) e parado. Regras:
//  1. a flag de bloqueio só cai quando o arquivo de bloqueio sumiu E o histórico prova o teto rebaixado a 5 (podeVoltar);
//  2. 1ª volta da semana: 1 teste limpo + 24 h do freio; 2ª: 2 testes limpos seguidos + 48 h; testes em @ DIFERENTES;
//  3. os 3 primeiros envios depois da volta são de prova (1 falha liga o freio na hora);
//  4. no máximo 2 voltas em 7 dias; o 3º freio em 7 dias deixa PARADO até o dono liberar (arquivo LIBERAR-INSTAGRAM.txt);
//  5. avisos fixos no pulso (avisoDoEstado): "VOLTOU SOZINHO", "TRAVOU DE NOVO", "PARADO ATÉ VOCÊ LIBERAR".
export const JANELA_VOLTAS_DIAS = 7;
export const MAX_VOLTAS_7D = 2;
export const FREIOS_PARA_PARAR = 3;
export const PROVA_ENVIOS = 3;
export const AVISO_VOLTOU_MIN = 40;           // o "VOLTOU SOZINHO" fica no pulso por 40 min (o cron roda de 15 em 15)
export const ARQ_LIBERAR_NOME = 'LIBERAR-INSTAGRAM.txt';
export const AVISO_VOLTOU = 'VOLTOU SOZINHO';
export const AVISO_TRAVOU = 'TRAVOU DE NOVO';
export const AVISO_PARADO = 'PARADO ATÉ VOCÊ LIBERAR';
const HORA_MS = 3600_000;
const msDe = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };
/** Itens (ISO) dos últimos `dias` dias corridos. */
export const recentes = (lista, agoraMs, dias = JANELA_VOLTAS_DIAS) =>
  (Array.isArray(lista) ? lista : []).filter(iso => { const t = msDe(iso); return Number.isFinite(t) && agoraMs - t <= dias * 86400_000 && t <= agoraMs + 60_000; });
/** O 3º freio (contando este) dentro de 7 dias corridos deixa o robô parado até o dono liberar. */
export const freiosParam = (freios, agoraMs) => recentes(freios, agoraMs).length >= FREIOS_PARA_PARAR;

/** Quantos testes limpos e quantas horas desde o freio a PRÓXIMA volta exige. null = já houve 2 voltas em 7 dias. */
export function exigenciaDaVolta(historico, agoraMs) {
  const v = recentes(historico && historico.voltas, agoraMs).length;
  if (v >= MAX_VOLTAS_7D) return null;
  return v === 0 ? { testes: 1, horas: 24, volta: 1 } : { testes: 2, horas: 48, volta: 2 };
}
/** Horas desde o último freio (NaN se não há). */
const horasDesdeFreio = (h, agoraMs) => (h && h.ultimo ? (agoraMs - msDe(h.ultimo)) / HORA_MS : NaN);

/** Já passou o tempo mínimo desde o freio para valer a pena TESTAR (não visita perfil à toa)? */
export function planoDeTeste({ historico, agoraMs }) {
  const h = historico;
  if (!h || h.corrompido || !h.ultimo) return { testar: false, motivo: 'sem histórico legível do freio' };
  if (h.parado) return { testar: false, motivo: 'PARADO até o dono liberar (arquivo ' + ARQ_LIBERAR_NOME + ')' };
  const ex = exigenciaDaVolta(h, agoraMs);
  if (!ex) return { testar: false, motivo: 'já houve ' + MAX_VOLTAS_7D + ' voltas em 7 dias: só o dono libera' };
  const horas = horasDesdeFreio(h, agoraMs);
  if (!(horas >= ex.horas)) return { testar: false, motivo: `faltam ${Math.ceil(ex.horas - (Number.isFinite(horas) ? horas : 0))} h para a ${ex.volta}ª volta (exige ${ex.horas} h desde o freio)`, exigencia: ex };
  return { testar: true, exigencia: ex };
}
/** @ normalizado: minúscula, sem @. */
const norm = a => String(a || '').replace(/^@/, '').trim().toLowerCase();
/** Primeiro da fila cujo @ não está entre os últimos 10 testes. null = ninguém novo. */
export function escolherAlvoTeste(fila, historico) {
  const ultimos = new Set(((historico && historico.testes) || []).slice(-10).map(t => norm(t.arroba)));
  const c = (Array.isArray(fila) ? fila : []).find(x => norm(x && x.instagram) && !ultimos.has(norm(x.instagram)));
  return c ? c.instagram : null;
}
/** Grava um teste (limpo ou não) no histórico, com o @ e a hora. Mantém os últimos 30. */
export function registrarTeste(historico, { arroba, limpo, agoraIso }) {
  const h = historico || {};
  return { ...h, testes: [...(h.testes || []), { arroba: norm(arroba), em: agoraIso, limpo: limpo === true }].slice(-30) };
}
/**
 * Pode destravar AGORA? Contando do freio: 1ª volta = 1 teste limpo + 24 h; 2ª = 2 testes limpos SEGUIDOS + 48 h;
 * os testes são em @ diferentes e posteriores ao freio. Devolve { destravar, motivo }.
 */
export function avaliarDestrave({ historico, agoraMs }) {
  const plano = planoDeTeste({ historico, agoraMs });
  if (!plano.testar) return { destravar: false, motivo: plano.motivo };
  const h = historico, ex = plano.exigencia;
  const doFreio = (h.testes || []).filter(t => msDe(t.em) > msDe(h.ultimo));
  const ultimos = doFreio.slice(-ex.testes);
  if (ultimos.length < ex.testes) return { destravar: false, motivo: `${ultimos.filter(t => t.limpo).length}/${ex.testes} teste(s) limpo(s) desde o freio` };
  if (!ultimos.every(t => t.limpo)) return { destravar: false, motivo: 'o teste mais recente falhou: exige ' + ex.testes + ' limpo(s) seguido(s)' };
  if (new Set(ultimos.map(t => norm(t.arroba))).size < ex.testes) return { destravar: false, motivo: 'os testes limpos precisam ser em @ diferentes' };
  return { destravar: true, motivo: `${ex.testes} teste(s) limpo(s) seguido(s) em @ diferentes e ${ex.horas} h desde o freio`, exigencia: ex };
}
/** Registra a volta: entra em voltas[] e abre a PROVA (3 envios). */
export function registrarVolta(historico, agoraIso) {
  const h = historico || {};
  const agoraMs = msDe(agoraIso);
  return { ...h, voltas: [...recentes(h.voltas, agoraMs, 14), agoraIso], prova: { ativa: true, confirmados: 0, desde: agoraIso } };
}
/** A última volta é posterior ao último freio (a volta deste freio já foi registrada)? */
export function jaVoltouDepoisDoFreio(h) {
  const v = h && Array.isArray(h.voltas) && h.voltas.length ? msDe(h.voltas[h.voltas.length - 1]) : NaN;
  return Number.isFinite(v) && (!h.ultimo || v > msDe(h.ultimo));
}
/**
 * REGRA 1: a flag de memória só cai quando o arquivo de bloqueio SUMIU e o histórico prova o teto rebaixado a 5
 * DEPOIS do último bloqueio, e o robô não está PARADO. Arquivo presente (inclusive criado à mão) = continua parado.
 */
export function podeVoltar({ bloqueio, historico }) {
  if (bloqueio && bloqueio.bloqueado) return { volta: false, motivo: 'o arquivo de bloqueio ainda existe' };
  const h = historico;
  if (!h || h.corrompido) return { volta: false, motivo: 'sem histórico legível do bloqueio' };
  if (h.parado) return { volta: false, motivo: 'PARADO até o dono liberar' };
  if (h.rebaixado !== true) return { volta: false, motivo: 'sem a prova do teto rebaixado a 5' };
  if (h.rebaixadoEm && h.ultimo && msDe(h.rebaixadoEm) < msDe(h.ultimo)) return { volta: false, motivo: 'o rebaixe é anterior ao último bloqueio' };
  // O sumiço do arquivo sozinho não basta: a volta tem que ter sido AUTORIZADA (teste limpo + 24 h/48 h, no testar-bloqueio)
  // ou liberada pelo dono. Sem isto, apagar o arquivo à mão pularia as regras de teste.
  if (h.freios && h.freios.length && !jaVoltouDepoisDoFreio(h)) return { volta: false, motivo: 'a volta ainda não foi autorizada (teste limpo + 24 h/48 h) nem liberada pelo dono' };
  return { volta: true };
}
/** Há um freio gravado pelo robô cuja volta ainda não foi autorizada? (vale mesmo se o arquivo de bloqueio sumiu) */
export const freioPendente = h => Boolean(h && !h.corrompido && Array.isArray(h.freios) && h.freios.length && !jaVoltouDepoisDoFreio(h));
/** Envio confirmado: só em conversa NOVA (false) conta para a prova; a 3ª encerra a prova (limite volta a 3 perfis). */
export function contarEnvioDeProva(historico, { conversaAntiga }, agoraIso) {
  const h = historico;
  if (!h || !h.prova || h.prova.ativa !== true || conversaAntiga !== false) return h;
  const confirmados = (h.prova.confirmados || 0) + 1;
  return { ...h, prova: confirmados >= PROVA_ENVIOS ? { ativa: false, confirmados, desde: h.prova.desde, fim: agoraIso } : { ...h.prova, confirmados } };
}
export const provaAtiva = h => Boolean(h && h.prova && h.prova.ativa === true);
/** O freio ligou: guarda no histórico (freios[], parado) e encerra a prova. */
export function registrarFreio(historico, agoraIso) {
  const h = historico || {};
  const agoraMs = msDe(agoraIso);
  const freios = [...recentes(h.freios, agoraMs, 14), agoraIso];
  return { ...h, ultimo: agoraIso, dia: diaDeIso(agoraIso), rebaixado: false, rebaixadoEm: null, freios, parado: freiosParam(freios, agoraMs), prova: null };
}
/** O dono liberou (arquivo LIBERAR-INSTAGRAM.txt): zera a contagem e o parado. */
export const liberarPeloDono = (historico, agoraIso) => ({ ...(historico || {}), parado: false, freios: [], voltas: [], liberadoEm: agoraIso });
/**
 * Texto FIXO do pulso para o cron do servidor (prefixos: "VOLTOU SOZINHO", "TRAVOU DE NOVO", "PARADO ATÉ VOCÊ LIBERAR").
 * null = nenhum dos três estados (o laço escreve o "fazendo" de sempre).
 */
export function avisoDoEstado({ bloqueado, historico, agoraMs }) {
  const h = historico;
  if (!h || h.corrompido) return null;
  if (bloqueado && (h.parado || exigenciaDaVolta(h, agoraMs) === null)) return `${AVISO_PARADO}: ${recentes(h.freios, agoraMs).length} freio(s) e ${recentes(h.voltas, agoraMs).length} volta(s) em 7 dias. Crie o arquivo ${ARQ_LIBERAR_NOME} na pasta worker-prospeccao para liberar.`;
  const voltas = recentes(h.voltas, agoraMs);
  if (bloqueado && voltas.length && !jaVoltouDepoisDoFreio(h)) return `${AVISO_TRAVOU}: o freio ligou de novo depois da volta de ${voltas[voltas.length - 1]} (${voltas.length} volta(s) em 7 dias). Parado até o teste limpo (24 h/48 h).`;
  const ult = h.voltas && h.voltas.length ? msDe(h.voltas[h.voltas.length - 1]) : NaN;
  if (!bloqueado && Number.isFinite(ult) && agoraMs - ult <= AVISO_VOLTOU_MIN * 60_000) {
    return `${AVISO_VOLTOU}: o Instagram deixou abrir conversa nova de novo. Teto 5/dia e os ${PROVA_ENVIOS} primeiros envios são de prova (1 falha para tudo na hora).`;
  }
  return null;
}
