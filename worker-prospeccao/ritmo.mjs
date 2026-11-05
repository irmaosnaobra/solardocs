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
  const maxSeg = Math.max(minSeg, num(env.MAX_SEG, 3600));
  const tetoEspera = Math.max(minSeg, num(env.TETO_ESPERA, 3600));
  // Teto do Instagram: a env só DESCE (1 a 10), nunca passa de 10.
  const tetoInstagramMax = Math.max(1, Math.min(TETO_INSTAGRAM, Math.round(num(env.TETO_INSTAGRAM_MAX, TETO_INSTAGRAM))));
  // Janela invertida ou vazia: fecha (ini = fim), nunca abre.
  return { horaIni: Math.min(horaIni, horaFim), horaFim, minSeg, maxSeg, tetoEspera, tetoInstagramMax };
}

/** Hora cheia (0-23), dia da semana (0 = domingo) e data (AAAA-MM-DD) em Brasília. */
export function relogioBRT(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO, hourCycle: 'h23', weekday: 'short', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { hora: Number(p.hour) % 24, dow, dia: `${p.year}-${p.month}-${p.day}` };
}

/** Pode ENVIAR agora? Segunda a sábado, de horaIni (inclusive) a horaFim (exclusive). */
export function podeEnviar(d = new Date(), cfg = cfgDe({})) {
  const { hora, dow } = relogioBRT(d);
  if (dow === 0) return false;
  return hora >= cfg.horaIni && hora < cfg.horaFim;
}

/**
 * Espera até o próximo envio, em segundos. O Math.max(minSeg) é a operação MAIS
 * EXTERNA: nenhum teto de espera, nenhuma conta de "sobra pouco" fura o piso.
 * `jitter` entra de fora (0.75 a 1.25) para o teste ser determinístico.
 */
export function calcularEspera({ agora = new Date(), cfg, restam, jitter = 1 }) {
  const { dia } = relogioBRT(agora);
  const fim = new Date(`${dia}T${String(cfg.horaFim).padStart(2, '0')}:00:00-03:00`);
  const sobramSeg = Math.max(60, Math.floor((fim - agora) / 1000));
  const ideal = Math.floor(sobramSeg / Math.max(1, restam));
  const bruto = Math.min(cfg.tetoEspera, Math.floor(ideal * jitter));
  return Math.max(cfg.minSeg, bruto);
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
    const pendente = p ? { id: p.id, pid: p.pid ?? null, ms: Number(p.ms) } : null;
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
 * Pode ENVIAR agora? Ordem: janela, piso, teto. `restam` indefinido = não confere o teto.
 * Devolve { enviar, motivo: 'janela'|'piso'|'teto'|null, esperaMs }.
 */
export function decidirAbordagem({ agora = new Date(), cfg, restam, banco, arquivo, pendente, bloqueio }) {
  // Bloqueio de conversa nova (arquivo bloqueio-<canal>.json ou detector em memória): frio 0.
  if (bloqueio && bloqueio.bloqueado) return { enviar: false, motivo: 'bloqueio', esperaMs: 3600_000 };
  // ENVIO PENDENTE DE GRAVAR (a DM saiu, mas o toque não entrou no banco): ninguém mais é abordado
  // até um toque gravar com sucesso. Vem da memória ou do arquivo local (sobrevive a reinício).
  const pend = pendente || (arquivo && arquivo.pendente) || null;
  if (pend) return { enviar: false, motivo: 'pendente', esperaMs: 120_000 };
  if (!podeEnviar(agora, cfg)) return { enviar: false, motivo: 'janela', esperaMs: 600_000 };
  const falta = faltaPiso({ agoraMs: agora.getTime(), cfg, banco, arquivo, pendente: pend });
  if (falta > 0) return { enviar: false, motivo: 'piso', esperaMs: falta };
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
    return { ultimo: j.ultimo || null, dia: j.dia || null, rebaixado: j.rebaixado === true, corrompido: false };
  } catch { return { ultimo: null, dia: null, rebaixado: false, corrompido: true }; }
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
